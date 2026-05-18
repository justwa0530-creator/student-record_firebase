import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Plus, Minus, Users, Settings, Save, RefreshCw, Trash2, 
  ChevronRight, ChevronLeft, MoreHorizontal, LogOut, Cloud, 
  CloudOff, CheckCircle2, AlertCircle, User, LogIn, ShieldCheck,
  Check, X, ClipboardList, UserPlus, GraduationCap, UploadCloud,
  FileSpreadsheet, UserCog, FileDown, ThumbsUp, ThumbsDown, Database,
  LayoutGrid, List, FileText, CheckSquare
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, 
  signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, getDoc, serverTimestamp, onSnapshot
} from 'firebase/firestore';
import * as XLSX from 'xlsx';

// --- 1. 共用常數與預設資料 (Constants) ---
const CATEGORIES = {
  positive: ['遵守秩序', '課業優良', '值日盡責', '整齊清潔', '服儀端正', '禮節週到', '熱心公務', '其他獎勵'],
  negative: ['秩序欠佳', '欠繳作業', '工作怠惰', '環境髒亂', '缺乏責任感', '言行不當', '遲到', '其他處罰']
};

// --- 2. Firebase 初始化 ---
const userFirebaseConfig = {
  apiKey: "AIzaSyAAu801RjoYkki3JEOw1WPQDGBHxLqAy3U",
  authDomain: "student-record-10391.firebaseapp.com",
  projectId: "student-record-10391",
  storageBucket: "student-record-10391.firebasestorage.app",
  messagingSenderId: "93081425564",
  appId: "1:93081425564:web:10ca88c855b46ef800bf59",
  measurementId: "G-YGE2HJHNQ9"
};

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : userFirebaseConfig;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'moral-pro-system';

// --- 3. 資料修復與工具函數 ---
const safeParse = (str, fallback = {}) => {
  if (!str) return fallback;
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
};

const repairData = (data) => {
  const defaultData = { classes: [], students: [], records: [], settings: { schoolName: "" }, lastSync: null };
  if (!data || typeof data !== 'object') return defaultData;
  const repaired = { ...defaultData, ...data };
  repaired.classes = repaired.classes || [];
  repaired.students = repaired.students || [];
  repaired.records = repaired.records || [];
  return repaired;
};

// 取得使用者顯示名稱
const getUserDisplayName = (user) => {
  if (!user) return '未登入';
  if (user.isAnonymous) return '訪客 (未綁定 Google)';
  if (user.displayName?.trim()) return user.displayName;
  if (user.providerData?.length > 0 && user.providerData[0].displayName?.trim()) return user.providerData[0].displayName;
  if (user.email) return user.email;
  if (user.providerData?.length > 0 && user.providerData[0].email) return user.providerData[0].email;
  return `特殊帳號-${user.uid.slice(0, 6)}`;
};

// --- 4. 主要元件 (App) ---
export default function App() {
  // 核心驗證狀態
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // 應用程式資料狀態
  const [appData, setAppData] = useState({ classes: [], students: [], records: [], settings: { schoolName: "" }, lastSync: null });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, success, error
  const [apiUrl, setApiUrl] = useState(''); // GAS URL

  // UI 互動狀態
  const [viewMode, setViewMode] = useState('grid'); // 'grid' | 'table'
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [modalOpen, setModalOpen] = useState(null); // 'score', 'importClass', 'editStudents', 'profile'
  const [targetStudentId, setTargetStudentId] = useState(null); // 個人檔案目標學生
  const [notification, setNotification] = useState(null);

  // ----------------------------------------------------------------
  // A. 驗證與資料初始化 (Auth Lifecycle)
  // ----------------------------------------------------------------
  useEffect(() => {
    const cached = localStorage.getItem('school_moral_v2');
    if (cached) {
      try { setAppData(repairData(safeParse(cached))); } catch (e) { console.error(e); }
    }
    const savedUrl = localStorage.getItem('gas_api_url');
    if (savedUrl) setApiUrl(savedUrl);

    // 背景檢查轉址登入結果
    (async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result?.user) await result.user.reload();
      } catch (error) {
        console.error("轉址登入發生錯誤:", error);
      }
    })();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setAuthLoading(false);
      if (u) {
        setUser(u);
        if (!u.isAnonymous) fetchCloudData(u.uid);
      } else {
        setUser(null);
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try { await signInWithCustomToken(auth, __initial_auth_token); } catch(e) {}
        }
      }
    });
    return () => unsubscribe();
  }, []);

  // ----------------------------------------------------------------
  // B. 雲端同步邏輯
  // ----------------------------------------------------------------
  const fetchCloudData = async (uid) => {
    if (!uid) return;
    setSyncStatus('syncing');
    try {
      const docRef = doc(db, 'artifacts', appId, 'users', uid, 'data', 'main');
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const cloudData = repairData(snap.data());
        setAppData(cloudData);
        localStorage.setItem('school_moral_v2', JSON.stringify(cloudData));
        setSyncStatus('success');
      } else {
        setSyncStatus('idle');
      }
    } catch (err) { setSyncStatus('error'); }
  };

  const saveState = useCallback(async (newData) => {
    const dataToSave = repairData(newData);
    setAppData(dataToSave);
    localStorage.setItem('school_moral_v2', JSON.stringify(dataToSave));
    
    let hasError = false;
    setSyncStatus('syncing');

    // 1. Firebase Sync
    if (user && !user.isAnonymous) {
      try {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'data', 'main');
        await setDoc(docRef, { ...dataToSave, lastSync: serverTimestamp() });
      } catch (err) {
        console.error("Firebase Sync Error", err);
        hasError = true;
      }
    }

    // 2. GAS Sync
    if (apiUrl) {
      try {
        await fetch(apiUrl, {
          method: 'POST',
          body: JSON.stringify({ data: dataToSave }),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        });
      } catch (err) {
        console.error("GAS Sync Error", err);
        hasError = true;
      }
    }

    if (hasError) {
      setSyncStatus('error');
    } else if ((user && !user.isAnonymous) || apiUrl) {
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2000);
    } else {
      setSyncStatus('idle');
    }
  }, [user, apiUrl]);

  const fetchFromGasCloud = async () => {
    if (!apiUrl) return;
    if (!window.confirm("確定要從 Google Sheet 下載舊有資料嗎？這將覆蓋手機目前的資料。")) return;
    setSyncStatus('syncing');
    try {
      const res = await fetch(apiUrl, { redirect: 'follow' });
      if (!res.ok) throw new Error('Network error');
      const cloudData = await res.json();
      if (cloudData && cloudData.classes) {
        const repaired = repairData(cloudData);
        saveState(repaired);
        showNotify('成功從 Google Sheet 下載最新資料！');
      }
    } catch (err) {
      setSyncStatus('error');
      showNotify('Google Sheet 下載失敗。請確定腳本已支援 GET 讀取功能。');
    }
  };

  const showNotify = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // ----------------------------------------------------------------
  // C. 驗證動作
  // ----------------------------------------------------------------
  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      if (!isMobile) {
        const result = await signInWithPopup(auth, provider);
        await result.user.reload();
      } else {
        await signInWithRedirect(auth, provider);
      }
    } catch (error) {
      if (error.code === 'auth/popup-blocked') {
        if (window.confirm("彈出視窗被封鎖，是否切換至頁面跳轉登入？")) signInWithRedirect(auth, provider);
      }
    } finally { setAuthLoading(false); }
  };

  const handleGuestLogin = async () => {
    setAuthLoading(true);
    try { await signInAnonymously(auth); } catch (e) { alert("訪客登入失敗"); }
    finally { setAuthLoading(false); }
  };

  const handleLogout = async () => {
    if (window.confirm("確定登出？未同步資料將遺失。")) {
      await signOut(auth);
      setAppData({ classes: [], students: [], records: [], settings: { schoolName: "" }, lastSync: null });
      localStorage.removeItem('school_moral_v2');
      setUser(null);
    }
  };

  // ----------------------------------------------------------------
  // D. 業務邏輯 (學生與評分管理)
  // ----------------------------------------------------------------
  
  // 計算目前選取班級的學生清單與分數
  const activeClassData = useMemo(() => {
    const cls = appData.classes.find(c => c.id === selectedClassId);
    if (!cls) return null;

    const classStudents = appData.students.filter(s => s.classId === cls.id);
    const studentsWithPoints = classStudents.map(s => {
      const sRecs = appData.records.filter(r => r.studentId === s.id);
      return {
        ...s,
        totalPoints: sRecs.reduce((sum, r) => sum + r.points, 0),
        positivePoints: sRecs.filter(r => r.points > 0).reduce((sum, r) => sum + r.points, 0),
        negativePoints: sRecs.filter(r => r.points < 0).reduce((sum, r) => sum + r.points, 0)
      };
    }).sort((a, b) => (parseInt(a.seatNo) || 0) - (parseInt(b.seatNo) || 0));

    return { ...cls, students: studentsWithPoints };
  }, [appData, selectedClassId]);

  const targetStudentProfile = useMemo(() => {
    if (!targetStudentId) return null;
    const student = appData.students.find(s => s.id === targetStudentId);
    if (!student) return null;
    // 依時間/ID降序排序，最新紀錄在最上面
    const records = appData.records.filter(r => r.studentId === targetStudentId).sort((a, b) => b.id.localeCompare(a.id));
    return { ...student, records };
  }, [appData, targetStudentId]);

  const toggleStudentSelection = (id) => {
    setSelectedStudents(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const selectAllStudents = () => {
    if (activeClassData) {
      setSelectedStudents(activeClassData.students.map(s => s.id));
    }
  };

  const handleSaveRecords = (type, item, points, note) => {
    const targetIds = isSelectionMode ? selectedStudents : [selectedStudents[0]];
    if (targetIds.length === 0) return;

    const newRecords = targetIds.map(stId => {
      const st = appData.students.find(s => s.id === stId);
      return {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        classId: selectedClassId,
        studentId: stId,
        studentName: st.name,
        studentNo: st.seatNo || '',
        date: new Date().toISOString().split('T')[0],
        type,
        item,
        points: type === 'positive' ? Math.abs(points) : -Math.abs(points),
        note: note || ''
      };
    });

    saveState({ ...appData, records: [...appData.records, ...newRecords] });
    setModalOpen(null);
    setIsSelectionMode(false);
    setSelectedStudents([]);
    showNotify(targetIds.length > 1 ? `已批次新增 ${targetIds.length} 筆紀錄` : `已新增紀錄`);
  };

  // 刪除單筆紀錄
  const handleDeleteRecord = (recordId) => {
    if (window.confirm("確定刪除這筆紀錄？分數將會自動扣回。")) {
      const newRecords = appData.records.filter(r => r.id !== recordId);
      saveState({ ...appData, records: newRecords });
      showNotify("紀錄已刪除，分數已自動更新！");
    }
  };

  const handleAddClass = (classData, students) => {
    const newClass = { id: Date.now().toString(), name: classData.name };
    const newStudents = students.map(s => ({
      id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      classId: newClass.id, 
      seatNo: s.seatNo, 
      name: s.name
    }));
    saveState({
      ...appData, 
      classes: [...appData.classes, newClass], 
      students: [...appData.students, ...newStudents]
    });
    setSelectedClassId(newClass.id);
    setActiveTab('dashboard');
    showNotify(`已新增班級「${newClass.name}」`);
  };

  const handleUpdateStudents = (classId, updatedStudents) => {
    const otherStudents = appData.students.filter(s => s.classId !== classId);
    saveState({ ...appData, students: [...otherStudents, ...updatedStudents] });
    showNotify('名單已更新！');
  };

  const handleDeleteClass = (classId) => {
    if (window.confirm('警告：刪除班級將永久移除該班所有學生與紀錄。確定刪除？')) {
      saveState({
        ...appData,
        classes: appData.classes.filter(c => c.id !== classId),
        students: appData.students.filter(s => s.classId !== classId),
        records: appData.records.filter(r => r.classId !== classId)
      });
      if (selectedClassId === classId) setSelectedClassId(null);
      showNotify("班級已刪除");
    }
  };

  const exportCSV = () => {
    if (!activeClassData) return;
    const csvRows = ['座號,姓名,優點,缺點,總計'];
    activeClassData.students.forEach(s => {
      csvRows.push(`${s.seatNo || ''},${s.name},${s.positivePoints},${s.negativePoints},${s.totalPoints}`);
    });
    const csvContent = '\uFEFF' + csvRows.join('\n'); // Add BOM for Excel
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${activeClassData.name}_總表.csv`;
    a.click();
  };

  // ----------------------------------------------------------------
  // E. 渲染元件
  // ----------------------------------------------------------------

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin" />
        <p className="text-indigo-600 font-bold tracking-widest">SYSTEM LOADING...</p>
      </div>
    );
  }

  // 登入牆 (Auth Guard)
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
        <div className="bg-white p-10 rounded-[3rem] shadow-xl max-w-sm w-full text-center space-y-8 border border-slate-100">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <ShieldCheck size={40} />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">品德雲端管理</h1>
            <p className="text-slate-500 font-medium leading-relaxed">專業、快速、穩定的<br/>班級經營評分助手</p>
          </div>
          <div className="space-y-3">
            <button 
              onClick={handleGoogleLogin}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition-all flex justify-center items-center gap-3"
            >
              <Cloud className="w-5 h-5"/> Google 帳號登入
            </button>
            <button 
              onClick={handleGuestLogin}
              className="w-full py-4 bg-white text-slate-700 border-2 border-slate-100 rounded-2xl font-bold active:scale-95 transition-all flex justify-center items-center gap-3 hover:bg-slate-50"
            >
              <User className="w-5 h-5"/> 先以訪客試用
            </button>
          </div>
          <p className="text-xs text-slate-400">登入即代表同意資料同步至雲端伺服器</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-28 lg:pb-0 lg:pl-64 flex flex-col select-none">
      
      {/* 提示通知 */}
      {notification && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 z-[100] animate-in slide-in-from-top-4 text-sm font-bold">
          <CheckCircle2 className="w-5 h-5 text-green-400" /> {notification}
        </div>
      )}

      {/* 側邊導覽 (Desktop) */}
      <aside className="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-slate-200 hidden lg:flex flex-col p-6 z-50">
        <div className="flex items-center gap-3 px-2 mb-10">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
            <ShieldCheck size={24} />
          </div>
          <span className="font-black text-xl">MoralPro</span>
        </div>
        
        <nav className="space-y-2 flex-1">
          {[
            { id: 'dashboard', icon: ClipboardList, label: '計分儀表板' },
            { id: 'classes', icon: Users, label: '班級管理' },
            { id: 'settings', icon: Settings, label: '系統設定' }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl font-bold transition-all ${
                activeTab === item.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'text-slate-400 hover:bg-slate-50'
              }`}
            >
              <item.icon size={22} /> {item.label}
            </button>
          ))}
        </nav>

        <div className="bg-slate-50 rounded-3xl p-4 mt-auto">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
              {user.photoURL && !user.isAnonymous ? <img src={user.photoURL} alt="avatar" /> : <User className="text-slate-400" />}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate text-slate-800">{getUserDisplayName(user)}</p>
              <p className="text-[10px] text-slate-400 truncate">{user.isAnonymous ? '資料僅存本機' : user.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full py-2 text-red-500 text-sm font-bold hover:bg-red-50 rounded-xl flex items-center justify-center gap-2 transition-colors">
            <LogOut size={16} /> 登出
          </button>
        </div>
      </aside>

      {/* 底部導覽 (Mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 lg:hidden bg-white/90 backdrop-blur-xl border-t border-slate-100 flex justify-around p-3 z-50">
        {[
          { id: 'dashboard', icon: ClipboardList, label: '儀表板' },
          { id: 'classes', icon: Users, label: '班級' },
          { id: 'settings', icon: Settings, label: '設定' }
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            className={`flex flex-col items-center gap-1 px-5 py-2 rounded-2xl transition-all ${
              activeTab === item.id ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'
            }`}
          >
            <item.icon size={24} />
            <span className="text-[10px] font-bold">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* 頂部 Header */}
      <header className="sticky top-0 bg-white/90 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex justify-between items-center z-40">
        <div>
          <h2 className="text-xl font-black text-slate-800">
            {activeTab === 'dashboard' ? '計分管理' : activeTab === 'classes' ? '班級設定' : '系統設定'}
          </h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className={`w-1.5 h-1.5 rounded-full ${syncStatus === 'success' ? 'bg-green-500' : syncStatus === 'syncing' ? 'bg-indigo-500 animate-pulse' : 'bg-slate-300'}`}></div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {syncStatus === 'syncing' ? 'Cloud Syncing' : syncStatus === 'success' ? 'Synced' : 'Local Only'}
            </span>
          </div>
        </div>
      </header>

      {/* 主內容區 */}
      <main className="flex-1 p-4 lg:p-8">
        {/* ----------------- 儀表板 ----------------- */}
        {activeTab === 'dashboard' && (
          <div className="max-w-5xl mx-auto space-y-6">
            
            {/* 班級切換區 */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
              {appData.classes.map(cls => (
                <button
                  key={cls.id}
                  onClick={() => { setSelectedClassId(cls.id); setIsSelectionMode(false); setSelectedStudents([]); }}
                  className={`px-6 py-3 rounded-2xl font-bold text-sm whitespace-nowrap transition-all ${
                    selectedClassId === cls.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200 scale-105' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {cls.name}
                </button>
              ))}
              <button 
                onClick={() => setActiveTab('classes')}
                className="px-5 py-3 rounded-2xl font-bold text-sm whitespace-nowrap bg-indigo-50 text-indigo-600 flex items-center gap-2 border border-indigo-100 hover:bg-indigo-100 transition-colors"
              >
                <Settings size={16} /> 管理班級
              </button>
            </div>

            {/* 動作列 (僅當有選擇班級時顯示) */}
            {activeClassData && (
              <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex flex-wrap gap-2 justify-between items-center">
                <div className="flex items-center gap-2">
                  {/* 視圖切換 (網格 / 表格) */}
                  <div className="hidden sm:flex items-center bg-slate-100 p-1.5 rounded-xl border border-slate-200 mr-2">
                    <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg transition-all ${viewMode==='grid'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`} title="卡片檢視"><LayoutGrid size={18}/></button>
                    <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-lg transition-all ${viewMode==='table'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`} title="條列檢視"><List size={18}/></button>
                  </div>
                  <button onClick={() => setModalOpen('editStudents')} className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 transition-colors font-bold text-sm flex items-center gap-2">
                    <UserCog size={18} /> <span className="hidden sm:inline">編輯名單</span>
                  </button>
                  <button onClick={exportCSV} className="p-2.5 bg-green-50 text-green-600 rounded-xl hover:bg-green-100 transition-colors font-bold text-sm flex items-center gap-2">
                    <FileDown size={18} /> <span className="hidden sm:inline">匯出總表</span>
                  </button>
                </div>
                <button 
                  onClick={() => { setIsSelectionMode(!isSelectionMode); setSelectedStudents([]); }}
                  className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
                    isSelectionMode ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <CheckSquare size={18} /> {isSelectionMode ? '取消多選' : '多選模式'}
                </button>
              </div>
            )}

            {/* 學生呈現區域 (依據 viewMode 切換) */}
            {activeClassData ? (
              viewMode === 'table' ? (
                /* --- 條列視圖 (Table View) --- */
                <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-6">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-sm">
                          {isSelectionMode && <th className="px-6 py-4 w-16 text-center">選取</th>}
                          <th className="px-6 py-4 font-bold whitespace-nowrap">座號</th>
                          <th className="px-6 py-4 font-bold whitespace-nowrap">姓名 <span className="text-xs text-slate-400 font-normal">(點擊看明細)</span></th>
                          <th className="px-6 py-4 font-bold text-green-600 whitespace-nowrap">優點</th>
                          <th className="px-6 py-4 font-bold text-red-500 whitespace-nowrap">缺點</th>
                          <th className="px-6 py-4 font-bold text-indigo-600 whitespace-nowrap">總分</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {activeClassData.students.map(st => (
                          <tr 
                            key={st.id}
                            onClick={() => {
                              if (isSelectionMode) {
                                toggleStudentSelection(st.id);
                              } else {
                                setTargetStudentId(st.id);
                                setModalOpen('profile');
                              }
                            }}
                            className={`hover:bg-slate-50 transition-colors cursor-pointer ${selectedStudents.includes(st.id) ? 'bg-indigo-50/60' : ''}`}
                          >
                            {isSelectionMode && (
                              <td className="px-6 py-4 text-center">
                                <div className={`w-5 h-5 rounded-md mx-auto flex items-center justify-center border-2 transition-colors ${selectedStudents.includes(st.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'}`}>
                                  {selectedStudents.includes(st.id) && <Check size={14} strokeWidth={3}/>}
                                </div>
                              </td>
                            )}
                            <td className="px-6 py-4 font-bold text-slate-400">{st.seatNo || '-'}</td>
                            <td className="px-6 py-4 font-black text-indigo-600 text-lg flex items-center gap-2">
                              {st.name} <FileText size={14} className="text-slate-300 hover:text-indigo-400 transition-colors" />
                            </td>
                            <td className="px-6 py-4 font-bold text-green-600">+{st.positivePoints}</td>
                            <td className="px-6 py-4 font-bold text-red-500">-{Math.abs(st.negativePoints)}</td>
                            <td className="px-6 py-4 font-black text-indigo-600 text-xl">{st.totalPoints}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* --- 網格視圖 (Grid View) --- */
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 lg:gap-4">
                  {activeClassData.students.map(st => (
                    <button
                      key={st.id}
                      onClick={() => {
                        if (isSelectionMode) {
                          toggleStudentSelection(st.id);
                        } else {
                          setSelectedStudents([st.id]);
                          setModalOpen('score');
                        }
                      }}
                      className={`relative p-4 rounded-[2rem] border-2 transition-all text-left flex flex-col justify-between aspect-square ${
                        selectedStudents.includes(st.id) 
                          ? 'border-indigo-600 bg-indigo-50 shadow-inner' 
                          : 'border-slate-100 bg-white shadow-sm hover:shadow-md hover:border-indigo-200'
                      }`}
                    >
                      <div className="flex justify-between items-start w-full">
                        <span className={`text-xs font-black px-2 py-1 rounded-lg ${selectedStudents.includes(st.id) ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-100 text-slate-500'}`}>
                          {st.seatNo || '-'}
                        </span>
                        {isSelectionMode && (
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                            selectedStudents.includes(st.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200'
                          }`}>
                            {selectedStudents.includes(st.id) && <Check size={14} />}
                          </div>
                        )}
                      </div>
                      
                      {/* 強調姓名，取消大字體總分 */}
                      <div className="flex-1 flex items-center justify-center py-4">
                         <span className="font-black text-slate-800 text-3xl truncate w-full text-center tracking-wide">{st.name}</span>
                      </div>
                      
                      <div className="flex gap-1.5 w-full">
                        <div className="flex flex-col items-center flex-1 rounded-xl py-1 bg-green-50/50">
                          <span className="text-[9px] font-bold text-green-600">優</span>
                          <span className="text-sm font-black text-green-700">{st.positivePoints}</span>
                        </div>
                        <div className="flex flex-col items-center flex-1 rounded-xl py-1 bg-red-50/50">
                          <span className="text-[9px] font-bold text-red-500">缺</span>
                          <span className="text-sm font-black text-red-600">{Math.abs(st.negativePoints)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="py-24 text-center bg-white rounded-[3rem] border border-slate-100 shadow-sm mt-8">
                <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-6 text-indigo-300">
                  <GraduationCap size={48} />
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">尚未選擇班級</h3>
                <p className="text-slate-400 font-medium mb-6">請在上方選擇班級，或前往班級管理新增</p>
                <button onClick={() => setActiveTab('classes')} className="bg-indigo-600 text-white px-8 py-3.5 rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:scale-105 transition-transform">
                  前往班級管理
                </button>
              </div>
            )}
          </div>
        )}

        {/* ----------------- 班級管理 ----------------- */}
        {activeTab === 'classes' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                <Users className="text-indigo-600" /> 現有班級
              </h3>
              <button onClick={() => setModalOpen('importClass')} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-md hover:bg-indigo-700 transition-colors">
                <Plus size={18} /> 新增 / 匯入班級
              </button>
            </div>

            {appData.classes.length === 0 ? (
              <div className="bg-white p-12 rounded-[2.5rem] text-center border-2 border-dashed border-slate-200">
                 <p className="text-slate-400 font-bold">目前沒有班級資料</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {appData.classes.map(cls => {
                  const stuCount = appData.students.filter(s => s.classId === cls.id).length;
                  return (
                    <div key={cls.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 bg-white rounded-[2rem] shadow-sm border border-slate-100 gap-4">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-xl">
                          {cls.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-black text-xl text-slate-800">{cls.name}</p>
                          <p className="text-sm text-slate-500 font-medium mt-1 flex items-center gap-1">
                            <User size={14}/> {stuCount} 位學生
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-auto">
                        <button 
                          onClick={() => { setSelectedClassId(cls.id); setActiveTab('dashboard'); }}
                          className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-sm transition-colors"
                        >
                          進入計分
                        </button>
                        <button 
                          onClick={() => handleDeleteClass(cls.id)}
                          className="p-2.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                          title="刪除班級"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ----------------- 系統設定 ----------------- */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-6">
            
            {/* 帳號區塊：強調自動同步 */}
            <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-100">
              <h3 className="text-xl font-black mb-2 flex items-center gap-2 text-slate-800">
                <Cloud className="text-indigo-600" /> 帳號管理與雲端備份
              </h3>
              <p className="text-sm text-slate-500 mb-6 font-medium leading-relaxed">
                只要登入 Google 帳號，您的所有資料與評分紀錄都會<strong className="text-indigo-600">自動且即時地同步至 Firebase 雲端資料庫</strong>，確保資料安全不遺失。
              </p>

              <div className="flex items-center justify-between p-6 bg-slate-50 rounded-3xl mb-6 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
                    {user.photoURL && !user.isAnonymous ? <img src={user.photoURL} alt="avatar" /> : <User size={32} className="text-slate-300" />}
                  </div>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black text-xl text-slate-800 truncate">{getUserDisplayName(user)}</span>
                    </div>
                    <p className="text-slate-500 text-sm font-medium truncate">
                      {user.isAnonymous ? '目前為訪客模式 (資料僅存本機)' : user.email}
                    </p>
                  </div>
                </div>
              </div>

              {user.isAnonymous ? (
                <div className="space-y-3">
                  <button onClick={handleGoogleLogin} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition flex justify-center items-center gap-2">
                    <Cloud size={20}/> 登入 Google 啟用雲端備份
                  </button>
                  <button onClick={handleLogout} className="w-full py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-bold active:scale-95 transition flex justify-center items-center gap-2">
                    <Trash2 size={20}/> 清除目前的訪客資料
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => saveState(appData)} className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 active:scale-95 transition flex justify-center items-center gap-2">
                    <RefreshCw size={20}/> 手動強制同步
                  </button>
                  <button onClick={handleLogout} className="flex-1 py-4 bg-red-50 text-red-600 border border-red-100 rounded-2xl font-bold active:scale-95 transition flex justify-center items-center gap-2">
                    <LogOut size={20}/> 登出系統
                  </button>
                </div>
              )}
            </div>

            {/* GAS 備份區塊：備用第二方案 */}
            <div className="bg-white rounded-[2.5rem] p-8 shadow-sm border border-slate-100">
              <h3 className="text-xl font-black mb-2 flex items-center gap-2 text-slate-800">
                <Database className="text-green-600" /> GAS 備用同步方案
              </h3>
              <p className="text-sm text-slate-500 font-medium mb-6 leading-relaxed">
                這是<strong className="text-amber-600">備案第二方案（非必填）</strong>。若您希望額外將資料寫入 Google Sheets 試算表以方便瀏覽或留存，才需要進行下方設定：
              </p>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 ml-2">Google App Script (GAS) 網址</label>
                  <input 
                    type="text" 
                    value={apiUrl} 
                    onChange={(e) => { setApiUrl(e.target.value); localStorage.setItem('gas_api_url', e.target.value); }}
                    placeholder="https://script.google.com/macros/s/.../exec"
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 font-medium text-sm transition-all"
                  />
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => saveState(appData)} 
                    disabled={!apiUrl}
                    className="flex-1 py-3.5 bg-green-50 text-green-700 rounded-xl font-bold active:scale-95 transition-all disabled:opacity-50 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    備份至試算表
                  </button>
                  <button 
                    onClick={fetchFromGasCloud} 
                    disabled={!apiUrl}
                    className="flex-1 py-3.5 bg-green-600 text-white rounded-xl font-bold active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md shadow-green-100"
                  >
                    <FileDown size={18} /> 從試算表下載
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>

      {/* 浮動多選動作條 */}
      {isSelectionMode && selectedStudents.length > 0 && (
        <div className="fixed bottom-24 lg:bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-4 rounded-full flex items-center gap-6 shadow-2xl z-50 animate-in slide-in-from-bottom-10">
          <span className="text-sm font-black whitespace-nowrap">已選 {selectedStudents.length} 人</span>
          <div className="flex gap-2">
            <button 
              onClick={selectAllStudents}
              className="bg-white/20 hover:bg-white/30 px-4 py-2 rounded-full font-bold text-sm transition-colors"
            >
              全選
            </button>
            <button 
              onClick={() => setModalOpen('score')}
              className="bg-indigo-500 hover:bg-indigo-400 px-6 py-2 rounded-full font-black text-sm shadow-lg transition-colors"
            >
              評分
            </button>
          </div>
        </div>
      )}

      {/* ----------------- Modals ----------------- */}
      
      {/* 1. 評分 Modal */}
      {modalOpen === 'score' && (
        <ScoreModal 
          selectedCount={selectedStudents.length}
          singleName={selectedStudents.length === 1 ? appData.students.find(s=>s.id===selectedStudents[0])?.name : null}
          onClose={() => { setModalOpen(null); if(isSelectionMode) setIsSelectionMode(false); setSelectedStudents([]); }}
          onSave={handleSaveRecords}
        />
      )}

      {/* 2. 匯入/新增班級 Modal */}
      {modalOpen === 'importClass' && (
        <ImportClassModal 
          onClose={() => setModalOpen(null)}
          onSave={handleAddClass}
          showNotify={showNotify}
        />
      )}

      {/* 3. 編輯學生名單 Modal */}
      {modalOpen === 'editStudents' && activeClassData && (
        <EditStudentsModal
          className={activeClassData.name}
          classId={activeClassData.id}
          students={activeClassData.students}
          onClose={() => setModalOpen(null)}
          onSave={(newStudents) => { handleUpdateStudents(activeClassData.id, newStudents); setModalOpen(null); }}
        />
      )}

      {/* 4. 新增：個人紀錄檔案 Modal */}
      {modalOpen === 'profile' && targetStudentProfile && (
        <ProfileModal 
          student={targetStudentProfile}
          records={targetStudentProfile.records}
          onClose={() => { setModalOpen(null); setTargetStudentId(null); }}
          onDeleteRecord={handleDeleteRecord}
        />
      )}

    </div>
  );
}

// ==========================================
// 獨立 Modal 元件
// ==========================================

// --- 個人檔案 Modal (新增功能) ---
function ProfileModal({ student, records, onClose, onDeleteRecord }) {
  // 統計分數
  const posPoints = records.filter(r => r.points > 0).reduce((sum, r) => sum + r.points, 0);
  const negPoints = records.filter(r => r.points < 0).reduce((sum, r) => sum + r.points, 0);
  const total = posPoints + negPoints;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4">
      <div className="bg-white w-full max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 max-h-[90vh] flex flex-col">
        
        <div className="flex justify-between items-center mb-6 flex-shrink-0">
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-1">座號 {student.seatNo || '-'}</p>
            <h3 className="text-2xl font-black text-indigo-600">{student.name} 的紀錄明細</h3>
          </div>
          <button onClick={onClose} className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex gap-3 mb-6 flex-shrink-0">
          <div className="flex-1 bg-slate-50 border border-slate-100 p-4 rounded-2xl text-center">
            <p className="text-xs font-bold text-slate-400 mb-1">總計</p>
            <p className={`text-2xl font-black ${total >= 0 ? 'text-indigo-600' : 'text-red-500'}`}>{total}</p>
          </div>
          <div className="flex-1 bg-green-50 border border-green-100 p-4 rounded-2xl text-center">
            <p className="text-xs font-bold text-green-600/70 mb-1">優點</p>
            <p className="text-2xl font-black text-green-600">+{posPoints}</p>
          </div>
          <div className="flex-1 bg-red-50 border border-red-100 p-4 rounded-2xl text-center">
            <p className="text-xs font-bold text-red-500/70 mb-1">缺點</p>
            <p className="text-2xl font-black text-red-500">-{Math.abs(negPoints)}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 min-h-[250px]">
          {records.length === 0 ? (
            <div className="py-12 text-center text-slate-400 font-bold border-2 border-dashed border-slate-100 rounded-3xl">
              目前沒有任何紀錄
            </div>
          ) : (
            <div className="space-y-3">
              {records.map(rec => (
                <div key={rec.id} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 group">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 font-black text-lg ${rec.points > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                    {rec.points > 0 ? '+' : ''}{rec.points}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-800 text-base">{rec.item || '未分類'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">{rec.date}</span>
                      {rec.note && <span className="text-xs text-slate-500 truncate">{rec.note}</span>}
                    </div>
                  </div>
                  <button 
                    onClick={() => onDeleteRecord(rec.id)} 
                    className="p-2.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    title="刪除此紀錄"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

// --- 評分 Modal ---
function ScoreModal({ selectedCount, singleName, onClose, onSave }) {
  const [type, setType] = useState('positive'); 
  const [item, setItem] = useState('');
  const [points, setPoints] = useState(1);
  const [note, setNote] = useState('');

  const isPos = type === 'positive';
  const list = isPos ? CATEGORIES.positive : CATEGORIES.negative;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-1">給分作業</p>
            <h3 className="text-2xl font-black text-indigo-600">{selectedCount === 1 ? singleName : `批次處理 (${selectedCount}人)`}</h3>
          </div>
          <button onClick={onClose} className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-6">
          <button onClick={() => { setType('positive'); setItem(''); setPoints(1); }} className={`flex-1 py-3.5 rounded-xl font-black transition-all flex items-center justify-center gap-2 ${isPos ? 'bg-white text-green-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><ThumbsUp size={18}/> 獎勵</button>
          <button onClick={() => { setType('negative'); setItem(''); setPoints(1); }} className={`flex-1 py-3.5 rounded-xl font-black transition-all flex items-center justify-center gap-2 ${!isPos ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}><ThumbsDown size={18}/> 懲處</button>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-6">
          {list.map(i => (
            <button key={i} onClick={() => setItem(i)} className={`py-3.5 px-2 text-xs font-bold rounded-xl border-2 transition-all ${item === i ? (isPos ? 'bg-green-50 border-green-500 text-green-700' : 'bg-red-50 border-red-500 text-red-700') : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'}`}>
              {i}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between bg-slate-50 p-5 rounded-2xl mb-4 border border-slate-100">
          <span className="font-black text-slate-700">設定配分</span>
          <div className="flex items-center gap-5">
            <button onClick={() => setPoints(Math.max(1, points-1))} className="w-10 h-10 bg-white rounded-full shadow-sm font-black text-slate-600 border border-slate-100 active:scale-90">-</button>
            <span className="text-3xl font-black text-indigo-600 w-8 text-center">{points}</span>
            <button onClick={() => setPoints(points+1)} className="w-10 h-10 bg-white rounded-full shadow-sm font-black text-slate-600 border border-slate-100 active:scale-90">+</button>
          </div>
        </div>

        <div className="mb-8">
          <label className="block text-sm font-bold text-slate-600 mb-2 ml-2">備註事項 (選填)</label>
          <input 
            type="text" 
            value={note} 
            onChange={(e) => setNote(e.target.value)}
            placeholder="輸入相關備註..." 
            className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 text-sm font-medium transition-all"
          />
        </div>

        <button 
          onClick={() => onSave(type, item, points, note)} 
          disabled={!item} 
          className={`w-full py-4.5 rounded-2xl font-black text-white text-lg shadow-lg transition-all active:scale-95 flex justify-center items-center gap-2 ${!item ? 'bg-slate-300 shadow-none' : (isPos ? 'bg-green-600 shadow-green-200' : 'bg-red-600 shadow-red-200')}`}
        >
          <Save size={20}/> 確認儲存
        </button>
      </div>
    </div>
  );
}

// --- 匯入/新增班級 Modal ---
function ImportClassModal({ onClose, onSave, showNotify }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileRef = useRef(null);

  const processFile = async () => {
    if (!name.trim()) return showNotify("請先輸入班級名稱");
    if (!file) {
      onSave({ name }, []);
      return;
    }

    setIsImporting(true);
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array' });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          
          if (!json.length) throw new Error("檔案為空");

          let hIdx = -1, sIdx = -1, nIdx = -1;
          for (let i = 0; i < Math.min(json.length, 10); i++) {
            const row = json[i].map(c => c.toString().trim());
            const fs = row.findIndex(h => h.includes('座號') || h.includes('號碼') || h === 'No');
            const fn = row.findIndex(h => h.includes('姓名') || h === 'Name');
            if (fs !== -1 && fn !== -1) { hIdx = i; sIdx = fs; nIdx = fn; break; }
          }

          if (hIdx === -1) throw new Error("找不到包含「座號」與「姓名」的標題欄");

          const students = [];
          for (let i = hIdx + 1; i < json.length; i++) {
            const row = json[i];
            const seatNo = row[sIdx]?.toString().trim();
            const sname = row[nIdx]?.toString().trim();
            if (seatNo || sname) students.push({ seatNo: seatNo || (students.length + 1), name: sname || "未命名" });
          }

          if (students.length === 0) throw new Error("沒有找到有效的學生資料");
          
          onSave({ name }, students);
        } catch (err) {
          showNotify("解析失敗: " + err.message);
        } finally {
          setIsImporting(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (err) {
      showNotify("讀取檔案失敗");
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 sm:p-6">
      <div className="bg-white w-full max-w-md rounded-[2.5rem] p-8 shadow-2xl animate-in zoom-in-95">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-2xl font-black text-slate-800">建立班級</h3>
          <button onClick={onClose} className="p-2 bg-slate-100 rounded-full text-slate-400"><X size={20}/></button>
        </div>
        
        <div className="space-y-6 mb-8">
          <div>
            <label className="block font-bold text-slate-700 mb-2 ml-1">班級名稱 <span className="text-red-500">*</span></label>
            <input 
              autoFocus
              value={name} onChange={e=>setName(e.target.value)}
              placeholder="例如：101班"
              className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-500 rounded-2xl p-4 outline-none font-bold transition-all"
            />
          </div>
          
          <div>
            <label className="block font-bold text-slate-700 mb-2 ml-1">匯入學生名單 (選填)</label>
            {!file ? (
              <div onClick={() => fileRef.current.click()} className="border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-slate-50 hover:bg-indigo-50/50 rounded-3xl p-8 text-center cursor-pointer transition-all">
                <input type="file" ref={fileRef} onChange={e => setFile(e.target.files[0])} accept=".xlsx,.csv" className="hidden" />
                <UploadCloud className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
                <p className="font-bold text-slate-600">點擊上傳 Excel 或 CSV</p>
                <p className="text-xs text-slate-400 mt-2">需包含「座號」與「姓名」欄位</p>
              </div>
            ) : (
              <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3 overflow-hidden">
                  <FileSpreadsheet className="w-8 h-8 text-indigo-600 flex-shrink-0" />
                  <span className="font-bold text-slate-700 truncate">{file.name}</span>
                </div>
                <button onClick={() => setFile(null)} className="p-2 bg-white rounded-full text-slate-400 hover:text-red-500 shadow-sm"><X size={16} /></button>
              </div>
            )}
          </div>
        </div>

        <button onClick={processFile} disabled={!name || isImporting} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black text-lg shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none transition-all active:scale-95 flex justify-center items-center gap-2">
          {isImporting ? <RefreshCw className="animate-spin w-5 h-5"/> : <CheckCircle2 className="w-5 h-5"/>} {file ? '匯入並建立' : '建立空班級'}
        </button>
      </div>
    </div>
  );
}

// --- 編輯學生名單 Modal ---
function EditStudentsModal({ classId, className, students, onClose, onSave }) {
  const [list, setList] = useState([...students]);
  const [newSeat, setNewSeat] = useState('');
  const [newName, setNewName] = useState('');

  const addStudent = () => {
    if (!newSeat.trim() || !newName.trim()) return;
    setList([...list, {
      id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      classId, seatNo: newSeat.trim(), name: newName.trim()
    }]);
    setNewSeat(''); setNewName('');
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4">
      <div className="bg-white w-full max-w-md rounded-t-[2.5rem] sm:rounded-[2.5rem] p-6 sm:p-8 shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 max-h-[90vh] flex flex-col">
        <div className="flex justify-between items-center mb-6 flex-shrink-0">
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-wider mb-1">{className}</p>
            <h3 className="text-2xl font-black text-slate-800">編輯學生名單</h3>
          </div>
          <button onClick={onClose} className="p-2.5 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500"><X size={20}/></button>
        </div>

        {/* 新增區塊 */}
        <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 mb-6 flex-shrink-0">
          <p className="text-xs font-bold text-indigo-800 mb-3 flex items-center gap-1"><UserPlus size={14}/> 加入轉入生</p>
          <div className="flex gap-2">
            <input type="number" value={newSeat} onChange={e=>setNewSeat(e.target.value)} placeholder="座號" className="w-16 p-3 rounded-xl border border-white focus:border-indigo-300 outline-none font-bold text-sm text-center" />
            <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="學生姓名" className="flex-1 p-3 rounded-xl border border-white focus:border-indigo-300 outline-none font-bold text-sm" />
            <button onClick={addStudent} disabled={!newSeat||!newName} className="px-4 bg-indigo-600 text-white rounded-xl font-bold disabled:opacity-50 active:scale-95 shadow-sm"><Plus size={20}/></button>
          </div>
        </div>

        {/* 列表區塊 */}
        <div className="flex-1 overflow-y-auto min-h-[200px] bg-slate-50 rounded-2xl p-2 border border-slate-100">
          {list.sort((a,b)=> (parseInt(a.seatNo)||0)-(parseInt(b.seatNo)||0)).map(s => (
            <div key={s.id} className="flex justify-between items-center p-3 bg-white mb-2 rounded-xl shadow-sm border border-slate-100 group">
              <div className="flex items-center gap-3">
                <span className="w-8 text-center text-xs font-black text-slate-400 bg-slate-50 py-1 rounded-md">{s.seatNo}</span>
                <span className="font-bold text-slate-700">{s.name}</span>
              </div>
              <button onClick={() => setList(list.filter(x=>x.id!==s.id))} className="text-slate-300 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-lg transition-colors">
                <Trash2 size={16}/>
              </button>
            </div>
          ))}
          {list.length === 0 && <p className="text-center text-slate-400 font-bold mt-10">尚無學生名單</p>}
        </div>

        <div className="pt-6 flex-shrink-0">
          <button onClick={() => onSave(list)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black shadow-lg shadow-slate-200 flex items-center justify-center gap-2 active:scale-95 transition-transform">
            <Save size={20} /> 儲存變更
          </button>
        </div>
      </div>
    </div>
  );
}