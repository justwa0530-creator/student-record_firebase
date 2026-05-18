import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Plus, Minus, Users, Settings, Save, RefreshCw, Trash2, 
  ChevronRight, LogOut, Cloud, CheckCircle2, User, ShieldCheck,
  Check, X, ClipboardList, UserPlus, GraduationCap, UploadCloud,
  FileSpreadsheet, UserCog, FileDown, ThumbsUp, ThumbsDown, Database,
  CheckSquare, LayoutDashboard, History, LayoutGrid, List
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, 
  signOut, signInAnonymously, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, getDoc, collection, onSnapshot, 
  deleteDoc, addDoc, writeBatch
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
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'moral-pro-system';

// --- 工具函數 ---
const safeParse = (str, fallback = {}) => {
  if (!str) return fallback;
  try { return JSON.parse(str) || fallback; } catch { return fallback; }
};

const getUserDisplayName = (user) => {
  if (!user) return '未登入';
  if (user.uid === 'local-guest') return '訪客 (本機模式)';
  if (user.displayName?.trim()) return user.displayName;
  if (user.providerData?.length > 0 && user.providerData[0].displayName?.trim()) return user.providerData[0].displayName;
  if (user.email) return user.email;
  return `特殊帳號-${user.uid.slice(0, 6)}`;
};

// --- 主程式組件 ---
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('classes');
  const [selectedClassId, setSelectedClassId] = useState(null);
  
  // App 資料狀態
  const [appData, setAppData] = useState({ classes: [], students: [], records: [], settings: { gasUrl: '' } });
  const [syncStatus, setSyncStatus] = useState('idle');
  
  // UI 狀態
  const [modalOpen, setModalOpen] = useState(null);
  const [multiSelect, setMultiSelect] = useState([]);
  const [isMultiMode, setIsMultiMode] = useState(false);
  const [viewMode, setViewMode] = useState('grid');
  const [notification, setNotification] = useState(null);
  const [showGasTutorial, setShowGasTutorial] = useState(false);

  // --- 1. 初始化讀取本地快取 ---
  useEffect(() => {
    const cached = localStorage.getItem('school_moral_v2');
    if (cached) {
      const parsed = safeParse(cached);
      setAppData({
        classes: parsed.classes || [],
        students: parsed.students || [],
        records: parsed.records || [],
        settings: parsed.settings || { gasUrl: '' }
      });
    }
  }, []);

  // --- 2. 認證與 Firebase 監聽 ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
      } else {
        setUser(prev => prev?.uid === 'local-guest' ? prev : null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || user.uid === 'local-guest') return;

    const unsubClasses = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'classes'), (s) => {
      setAppData(prev => ({ ...prev, classes: s.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubStudents = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'students'), (s) => {
      setAppData(prev => ({ ...prev, students: s.docs.map(d => ({ id: d.id, ...d.data() })) }));
    });
    const unsubRecords = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'records'), (s) => {
      const recs = s.docs.map(d => ({ id: d.id, ...d.data() }));
      setAppData(prev => ({ ...prev, records: recs.sort((a, b) => b.timestamp - a.timestamp) }));
    });
    const unsubSettings = onSnapshot(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), (d) => {
      if (d.exists()) setAppData(prev => ({ ...prev, settings: d.data() }));
      setSyncStatus('success');
    });

    return () => { unsubClasses(); unsubStudents(); unsubRecords(); unsubSettings(); };
  }, [user]);

  const showNotify = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // --- 3. 動作處理 (樂觀更新架構) ---
  const handleGuestLogin = () => {
    setUser({ uid: 'local-guest', isAnonymous: true, displayName: '訪客' });
  };

  const handleGoogleLogin = async () => {
    try { 
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' }); 
      await signInWithPopup(auth, provider); 
    } catch (e) { console.error(e); }
  };

  const handleLogout = async () => {
    if (window.confirm("確定登出系統？(未綁定的訪客資料會保留在瀏覽器中)")) {
      if (user?.uid !== 'local-guest') {
        await signOut(auth);
      }
      setUser(null);
    }
  };

  const handleAddClass = async (classData, students) => {
    const newClassId = Date.now().toString();
    const newClass = { id: newClassId, name: classData.name || "未命名", createdAt: Date.now() };
    
    const newStudents = (students || []).map(s => ({
      id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      classId: newClassId, name: s.name || "無名", seatNo: s.seatNo || "", totalScore: 0, createdAt: Date.now()
    }));

    setAppData(prev => {
      const nextData = { ...prev, classes: [...prev.classes, newClass], students: [...prev.students, ...newStudents] };
      localStorage.setItem('school_moral_v2', JSON.stringify(nextData));
      return nextData;
    });
    setModalOpen(null);
    showNotify("班級建立成功！");

    if (user && user.uid !== 'local-guest') {
      try {
        const batch = writeBatch(db);
        batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'classes', newClassId), newClass);
        newStudents.forEach(s => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'students', s.id), s));
        await batch.commit();
      } catch (e) { console.error("Firebase sync failed", e); }
    }
  };

  const handleDeleteClass = async (id) => {
    if (!window.confirm("確定刪除班級？此動作無法復原。")) return;
    
    setAppData(prev => {
      const nextData = {
        ...prev,
        classes: prev.classes.filter(c => c.id !== id),
        students: prev.students.filter(s => s.classId !== id),
        records: prev.records.filter(r => r.classId !== id)
      };
      localStorage.setItem('school_moral_v2', JSON.stringify(nextData));
      return nextData;
    });
    if (selectedClassId === id) setSelectedClassId(null);
    showNotify("班級已刪除");

    if (user && user.uid !== 'local-guest') {
      try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'classes', id)); } 
      catch (e) { console.error(e); }
    }
  };

  const handleScore = async (studentIds, type, item, amount, note = "") => {
    const timestamp = Date.now();
    const scoreDelta = type === 'positive' ? amount : -amount;
    
    const newRecords = studentIds.map(sid => {
      const st = appData.students.find(s => s.id === sid);
      return {
        id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        studentId: sid, studentName: st?.name || '未知', classId: st?.classId,
        type, item, score: scoreDelta, note, timestamp
      };
    });

    setAppData(prev => {
      const nextData = {
        ...prev,
        records: [...newRecords, ...prev.records].sort((a, b) => b.timestamp - a.timestamp),
        students: prev.students.map(s => studentIds.includes(s.id) ? { ...s, totalScore: (s.totalScore || 0) + scoreDelta } : s)
      };
      localStorage.setItem('school_moral_v2', JSON.stringify(nextData));
      return nextData;
    });

    setModalOpen(null);
    if (isMultiMode) { setMultiSelect([]); setIsMultiMode(false); }
    showNotify(studentIds.length > 1 ? `已批次新增 ${studentIds.length} 筆紀錄` : "已新增紀錄");

    if (user && user.uid !== 'local-guest') {
      try {
        const batch = writeBatch(db);
        newRecords.forEach(r => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'records', r.id), r));
        studentIds.forEach(sid => {
          const st = appData.students.find(s => s.id === sid);
          batch.update(doc(db, 'artifacts', appId, 'users', user.uid, 'students', sid), { 
            totalScore: (st?.totalScore || 0) + scoreDelta 
          });
        });
        await batch.commit();
      } catch (e) { console.error("Firebase update failed", e); }
    }
  };

  const handleAddStudent = async (classId, seatNo, name) => {
    const newStudent = { id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`, classId, seatNo, name, totalScore: 0, createdAt: Date.now() };
    
    setAppData(prev => {
      const nextData = { ...prev, students: [...prev.students, newStudent] };
      localStorage.setItem('school_moral_v2', JSON.stringify(nextData));
      return nextData;
    });

    if (user && user.uid !== 'local-guest') {
      try { await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'students', newStudent.id), newStudent); } catch(e){}
    }
  };

  const handleDeleteStudent = async (id) => {
    if (!window.confirm("確定移除該名學生？")) return;
    setAppData(prev => {
       const nextData = { ...prev, students: prev.students.filter(s => s.id !== id) };
       localStorage.setItem('school_moral_v2', JSON.stringify(nextData));
       return nextData;
    });

    if (user && user.uid !== 'local-guest') {
      try { await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'students', id)); } catch(e){}
    }
  };

  const handleGasManualSync = async () => {
    if (!appData.settings.gasUrl) {
      showNotify("請先填寫並儲存 GAS 網址！");
      return;
    }
    setSyncStatus('syncing');
    try {
      await fetch(appData.settings.gasUrl, {
        method: 'POST',
        body: JSON.stringify({ data: appData }),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: "follow"
      });
      showNotify("✅ 手動備份指令已發送！");
      setSyncStatus('success');
      setTimeout(() => setSyncStatus('idle'), 2000);
    } catch (err) {
      console.error(err);
      showNotify("❌ 備份失敗，請檢查網址或權限設定");
      setSyncStatus('error');
    }
  };

  const handleGasDownload = async () => {
    if (!appData.settings.gasUrl) {
      showNotify("請先填寫 GAS 網址！");
      return;
    }
    if (!window.confirm("這將會覆蓋掉目前的本地資料，確定要從雲端下載嗎？")) return;

    setSyncStatus('syncing');
    try {
      const response = await fetch(appData.settings.gasUrl, { redirect: "follow" });
      const cloudData = await response.json();

      if (cloudData && (cloudData.classes || cloudData.students)) {
        
        const normalizedRecords = (cloudData.records || []).map(r => ({
          ...r,
          timestamp: r.timestamp || (r.date ? new Date(r.date).getTime() : Date.now()),
          score: r.score !== undefined ? r.score : (r.points !== undefined ? r.points : 0),
          item: r.item || '未分類',
          note: r.note || ''
        }));
        
        cloudData.records = normalizedRecords;
        
        setAppData(prev => {
          const nextData = { ...cloudData, settings: prev.settings };
          localStorage.setItem('school_moral_v2', JSON.stringify(nextData));
          return nextData;
        });
        
        if (user && user.uid !== 'local-guest') {
          const batch = writeBatch(db);
          (cloudData.classes || []).forEach(c => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'classes', c.id), c));
          (cloudData.students || []).forEach(s => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'students', s.id), s));
          normalizedRecords.forEach(r => batch.set(doc(db, 'artifacts', appId, 'users', user.uid, 'records', r.id), r));
          await batch.commit();
        }
        
        showNotify("✅ 雲端資料下載成功！");
        setSyncStatus('success');
      } else {
        showNotify("⚠️ 雲端目前沒有有效的資料");
        setSyncStatus('idle');
      }
    } catch (err) {
      console.error(err);
      showNotify("❌ 下載失敗，請確保已發佈新版 GAS 程式碼");
      setSyncStatus('error');
    } finally {
      setTimeout(() => setSyncStatus('idle'), 2000);
    }
  };

  const handleExport = () => {
    const csvContent = "\uFEFF" + "日期,學生,班級,類型,項目,分數,備註\n" +
      appData.records.filter(r => r.classId === selectedClassId).map(r => {
        const date = new Date(r.timestamp).toLocaleDateString();
        const cls = appData.classes.find(c => c.id === r.classId)?.name || '未知';
        return `${date},${r.studentName},${cls},${r.type === 'positive' ? '獎勵' : '懲處'},${r.item || ''},${r.score},${r.note}`;
      }).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }));
    link.download = `品德紀錄_${new Date().toLocaleDateString()}.csv`;
    link.click();
  };

  // 結算當前選取班級的資料
  const activeClassData = useMemo(() => {
    const cls = appData.classes.find(c => c.id === selectedClassId);
    if (!cls) return null;
    const classStudents = appData.students.filter(s => s.classId === cls.id);
    const studentsWithPoints = classStudents.map(s => {
      const sRecs = appData.records.filter(r => r.studentId === s.id);
      return {
        ...s,
        totalPoints: sRecs.reduce((sum, r) => sum + (r.score || 0), 0),
        positivePoints: sRecs.filter(r => r.type === 'positive').reduce((sum, r) => sum + (r.score || 0), 0),
        negativePoints: sRecs.filter(r => r.type === 'negative').reduce((sum, r) => sum + (r.score || 0), 0)
      };
    }).sort((a, b) => (parseInt(a.seatNo) || 0) - (parseInt(b.seatNo) || 0));
    return { ...cls, students: studentsWithPoints };
  }, [appData, selectedClassId]);

  // --- 畫面渲染 ---
  if (!user && !authLoading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-[3rem] shadow-2xl p-10 text-center border border-slate-100">
          <div className="w-20 h-20 bg-indigo-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-lg shadow-indigo-200">
            <ShieldCheck size={40} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-2">品德紀錄 Pro</h1>
          <p className="text-slate-500 font-medium mb-10">專業、高效、數據化的班級管理工具</p>
          <div className="space-y-4">
            <button onClick={handleGoogleLogin} className="w-full py-4 bg-indigo-600 text-white rounded-2xl flex items-center justify-center gap-3 font-bold transition-all hover:bg-indigo-700 shadow-lg shadow-indigo-100">
              <Cloud size={20} /> 使用 Google 帳號登入
            </button>
            <button onClick={handleGuestLogin} className="w-full py-4 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-2xl flex items-center justify-center gap-3 font-bold transition-all">
              <User size={20} /> 以訪客身分試用
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (authLoading) return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <RefreshCw className="animate-spin text-indigo-600" size={40} />
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-24 lg:pb-0 lg:pl-24 select-none">
      
      {notification && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 z-[100] animate-in slide-in-from-top-4 text-sm font-bold">
          <CheckCircle2 className="w-5 h-5 text-green-400" /> {notification}
        </div>
      )}

      {/* 導覽列 */}
      <nav className="fixed bottom-0 left-0 right-0 lg:top-0 lg:bottom-0 lg:w-24 bg-white border-t lg:border-t-0 lg:border-r border-slate-100 z-50 flex lg:flex-col items-center justify-around lg:justify-center p-4 gap-8">
        <div className="hidden lg:flex w-14 h-14 bg-indigo-600 rounded-2xl items-center justify-center text-white mb-auto shadow-lg shadow-indigo-100">
          <GraduationCap size={28} />
        </div>
        <NavButton active={activeTab === 'classes'} onClick={() => setActiveTab('classes')} icon={<Users size={24}/>} label="班級" />
        <NavButton active={activeTab === 'behavior'} onClick={() => setActiveTab('behavior')} icon={<ClipboardList size={24}/>} label="紀錄" />
        <NavButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<Settings size={24}/>} label="設定" />
        <button onClick={handleLogout} className="hidden lg:flex mt-auto p-4 text-slate-400 hover:text-red-500 transition-colors">
          <LogOut size={24} />
        </button>
      </nav>

      {/* 桌面版專屬：豐富左側邊欄擴充 */}
      <aside className="fixed left-24 top-0 bottom-0 w-64 bg-white border-r border-slate-200 hidden 2xl:flex flex-col z-40">
        <div className="p-8 border-b border-slate-100">
          <h2 className="text-2xl font-black text-slate-800 tracking-tight">Moral Pro</h2>
          <p className="text-sm font-bold text-indigo-500 mt-1">學生品德管理系統</p>
        </div>
        <div className="flex-1 p-6 space-y-2 overflow-y-auto">
          {appData.classes.length === 0 ? (
            <p className="text-sm font-bold text-slate-400 text-center mt-10">尚無建立班級</p>
          ) : (
            appData.classes.map(c => (
              <button 
                key={c.id} 
                onClick={() => { setSelectedClassId(c.id); setActiveTab('behavior'); }}
                className={`w-full text-left px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-between ${selectedClassId === c.id && activeTab === 'behavior' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {c.name}
                <ChevronRight size={16} className={selectedClassId === c.id && activeTab === 'behavior' ? 'text-indigo-400' : 'text-slate-300'} />
              </button>
            ))
          )}
        </div>
        
        {/* 側邊欄下方：顯示帳號頭像與登出按鈕 */}
        <div className="mt-auto border-t border-slate-100 pt-6 pb-6 px-6">
          <div className="flex items-center justify-between group">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                {user?.photoURL && user.uid !== 'local-guest' ? <img src={user.photoURL} alt="avatar" /> : <User className="text-slate-400" size={20} />}
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold truncate text-slate-800">{getUserDisplayName(user)}</p>
                <p className="text-[10px] text-slate-400 truncate">{user.uid === 'local-guest' ? '資料僅存本機' : user.email}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors" title="登出系統">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </aside>

      <main className="max-w-6xl mx-auto p-6 md:p-10 2xl:pl-72">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
              {activeTab === 'classes' ? '班級管理' : activeTab === 'behavior' ? '行為計分紀錄' : '系統備份與設定'}
            </h1>
            <p className="text-slate-500 font-medium mt-1 2xl:hidden">{user.uid === 'local-guest' ? '訪客模式 (本機暫存)' : `歡迎回來，${getUserDisplayName(user)}`}</p>
          </div>
          <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm">
            {user.uid === 'local-guest' ? (
               <div className="px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 bg-slate-50 text-slate-500">
                 <div className="w-2 h-2 rounded-full bg-slate-400" /> 離線本機模式
               </div>
            ) : (
               <div className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${syncStatus === 'success' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                 <div className={`w-2 h-2 rounded-full ${syncStatus === 'success' ? 'bg-green-500' : 'bg-blue-500 animate-pulse'}`} /> 雲端連線中
               </div>
            )}
          </div>
        </header>

        {/* ---------------- 班級管理 ---------------- */}
        {activeTab === 'classes' && (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex justify-end">
              <button onClick={() => setModalOpen('importClass')} className="bg-indigo-600 text-white px-5 py-3 rounded-xl font-bold flex items-center gap-2 shadow-md hover:bg-indigo-700 transition-colors">
                <Plus size={18} /> 新增 / 匯入班級
              </button>
            </div>
            {appData.classes.length === 0 ? (
              <EmptyState title="目前沒有班級" subtitle="點擊上方按鈕建立第一個班級" icon={<Users size={48}/>} />
            ) : (
              <div className="grid gap-4">
                {appData.classes.map(cls => (
                  <div key={cls.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-6 bg-white rounded-[2rem] shadow-sm border border-slate-100 gap-4">
                    <div className="flex items-center gap-5">
                      <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-2xl">
                        {(cls.name || '班').charAt(0)}
                      </div>
                      <div>
                        <p className="font-black text-xl text-slate-800">{cls.name}</p>
                        <p className="text-sm text-slate-500 font-medium mt-1 flex items-center gap-1"><User size={14}/> {appData.students.filter(s=>s.classId===cls.id).length} 位學生</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { setSelectedClassId(cls.id); setModalOpen('editStudents'); }} className="px-4 py-2.5 bg-blue-50 text-blue-700 rounded-xl font-bold text-sm hover:bg-blue-100 flex items-center gap-1">
                        <UserCog size={16} /> 編輯名單
                      </button>
                      <button onClick={() => { setSelectedClassId(cls.id); setActiveTab('behavior'); }} className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 flex items-center gap-1">
                        <ClipboardList size={16} /> 計分
                      </button>
                      <button onClick={() => handleDeleteClass(cls.id)} className="p-2.5 text-red-400 hover:bg-red-50 rounded-xl transition-all"><Trash2 size={20} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------- 行為記錄 ---------------- */}
        {activeTab === 'behavior' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar 2xl:hidden">
                {appData.classes.map(c => (
                  <button 
                    key={c.id} onClick={() => { setSelectedClassId(c.id); setIsMultiMode(false); setMultiSelect([]); }}
                    className={`px-6 py-3 rounded-2xl font-bold text-sm whitespace-nowrap transition-all border-2 ${selectedClassId === c.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-500'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                {/* 視圖切換 (總表 / 網格卡片) */}
                <div className="hidden sm:flex items-center bg-slate-200/50 p-1.5 rounded-xl border border-slate-200">
                  <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded-lg transition-all ${viewMode==='grid'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`} title="卡片檢視"><LayoutGrid size={18}/></button>
                  <button onClick={() => setViewMode('table')} className={`p-1.5 rounded-lg transition-all ${viewMode==='table'?'bg-white shadow-sm text-indigo-600':'text-slate-400 hover:text-slate-600'}`} title="總表檢視"><List size={18}/></button>
                </div>
                
                <button onClick={() => { setIsMultiMode(!isMultiMode); setMultiSelect([]); }} className={`flex-1 md:flex-none px-4 py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${isMultiMode ? 'bg-amber-100 text-amber-700' : 'bg-white text-slate-700 border border-slate-200'}`}>
                  <CheckSquare size={18} /> {isMultiMode ? '取消多選' : '多選模式'}
                </button>
                <button onClick={handleExport} disabled={!activeClassData} className="flex-1 md:flex-none px-4 py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50">
                  <FileDown size={18} /> 下載總表
                </button>
              </div>
            </div>

            {activeClassData ? (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <div className="xl:col-span-2">
                   
                   {/* 總表檢視 (Table View) */}
                   {viewMode === 'table' ? (
                     <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-6">
                       <div className="overflow-x-auto">
                         <table className="w-full text-left border-collapse">
                           <thead>
                             <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 text-sm">
                               {isMultiMode && <th className="px-6 py-4 w-16 text-center">選取</th>}
                               <th className="px-6 py-4 font-bold whitespace-nowrap">座號</th>
                               <th className="px-6 py-4 font-bold whitespace-nowrap">姓名</th>
                               <th className="px-6 py-4 font-bold text-green-600 whitespace-nowrap">優點</th>
                               <th className="px-6 py-4 font-bold text-red-500 whitespace-nowrap">缺點</th>
                               <th className="px-6 py-4 font-bold text-indigo-600 whitespace-nowrap">總分</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-50">
                             {activeClassData.students.map(stu => (
                               <tr 
                                 key={stu.id}
                                 onClick={() => isMultiMode ? setMultiSelect(prev => prev.includes(stu.id) ? prev.filter(id=>id!==stu.id) : [...prev, stu.id]) : (() => { setMultiSelect([stu.id]); setModalOpen('score'); })()}
                                 className={`hover:bg-slate-50 transition-colors cursor-pointer ${multiSelect.includes(stu.id) ? 'bg-indigo-50/60' : ''}`}
                               >
                                 {isMultiMode && (
                                   <td className="px-6 py-4 text-center">
                                     <div className={`w-5 h-5 rounded-md mx-auto flex items-center justify-center border-2 transition-colors ${multiSelect.includes(stu.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300'}`}>
                                       {multiSelect.includes(stu.id) && <Check size={14} strokeWidth={3}/>}
                                     </div>
                                   </td>
                                 )}
                                 <td className="px-6 py-4 font-bold text-slate-400">{stu.seatNo || '-'}</td>
                                 <td className="px-6 py-4 font-black text-slate-800 text-lg">{stu.name}</td>
                                 <td className="px-6 py-4 font-bold text-green-600">+{stu.positivePoints}</td>
                                 <td className="px-6 py-4 font-bold text-red-500">-{Math.abs(stu.negativePoints)}</td>
                                 <td className="px-6 py-4 font-black text-indigo-600 text-xl">{stu.totalPoints}</td>
                               </tr>
                             ))}
                           </tbody>
                         </table>
                         {activeClassData.students.length === 0 && (
                           <div className="p-10 text-center text-slate-400 font-bold">此班級尚無學生名單</div>
                         )}
                       </div>
                     </div>
                   ) : (
                     // 網格卡片檢視 (Grid View)
                     <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
                       {activeClassData.students.map(stu => (
                         <div 
                           key={stu.id}
                           onClick={() => isMultiMode ? setMultiSelect(prev => prev.includes(stu.id) ? prev.filter(id=>id!==stu.id) : [...prev, stu.id]) : (() => { setMultiSelect([stu.id]); setModalOpen('score'); })()}
                           className={`relative cursor-pointer p-4 rounded-3xl border-2 transition-all flex flex-col justify-between aspect-square active:scale-95 ${multiSelect.includes(stu.id) ? 'border-indigo-600 bg-indigo-50' : 'border-slate-100 bg-white shadow-sm hover:border-indigo-200'}`}
                         >
                           <div className="flex justify-between items-start w-full mb-1">
                             <span className={`text-xs font-black px-2 py-1 rounded-lg ${multiSelect.includes(stu.id) ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-100 text-slate-500'}`}>{stu.seatNo || '-'}</span>
                             {isMultiMode && <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${multiSelect.includes(stu.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200'}`}>{multiSelect.includes(stu.id) && <Check size={14} />}</div>}
                           </div>
                           
                           {/* 改為強調姓名 */}
                           <div className="flex-1 flex items-center justify-center py-2">
                             <span className="font-black text-slate-800 text-center truncate w-full text-2xl">{stu.name}</span>
                           </div>
                           
                           {/* 在卡片下方簡單顯示優缺點提示 */}
                           <div className="flex gap-1.5 w-full mt-2">
                             <div className="flex-1 bg-green-50 text-green-700 text-[10px] font-bold py-1.5 rounded-lg text-center">優 {stu.positivePoints}</div>
                             <div className="flex-1 bg-red-50 text-red-700 text-[10px] font-bold py-1.5 rounded-lg text-center">缺 {Math.abs(stu.negativePoints)}</div>
                           </div>
                         </div>
                       ))}
                     </div>
                   )}

                   {/* 多選操作列 */}
                   {isMultiMode && multiSelect.length > 0 && (
                     <div className="fixed bottom-24 lg:bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-4 rounded-full flex items-center gap-6 shadow-2xl z-50 animate-in slide-in-from-bottom-10">
                        <span className="text-sm font-black whitespace-nowrap">已選 {multiSelect.length} 人</span>
                        <div className="flex gap-2">
                          <button onClick={() => setMultiSelect(activeClassData.students.map(s => s.id))} className="bg-white/20 px-4 py-2 rounded-full font-bold text-sm hover:bg-white/30 transition-colors">全選</button>
                          <button onClick={() => setModalOpen('score')} className="bg-indigo-500 px-6 py-2 rounded-full font-black text-sm hover:bg-indigo-400 transition-colors shadow-lg">評分</button>
                        </div>
                     </div>
                   )}
                </div>

                {/* 最近紀錄列表 */}
                <div className="bg-white rounded-[2.5rem] border border-slate-100 p-6 shadow-sm h-fit">
                   <div className="flex items-center justify-between mb-6">
                     <h3 className="font-black text-lg flex items-center gap-2"><History size={20} className="text-indigo-600" /> 最近活動</h3>
                   </div>
                   <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                     {appData.records.filter(r => r.classId === selectedClassId).slice(0, 15).map(rec => {
                       const isValidDate = rec.timestamp && !isNaN(new Date(rec.timestamp).getTime());
                       const timeStr = isValidDate ? new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                       return (
                       <div key={rec.id} className="flex gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                         <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${rec.type === 'positive' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                           {rec.type === 'positive' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
                         </div>
                         <div className="flex-1 min-w-0">
                           <div className="flex justify-between items-center">
                             <p className="font-bold text-sm text-slate-800 truncate">{rec.studentName}</p>
                             <span className="text-[10px] font-bold text-slate-400">{timeStr}</span>
                           </div>
                           <p className="text-xs text-slate-500 font-medium truncate">{rec.item || '未分類'} ({rec.score > 0 ? '+' : ''}{rec.score}) {rec.note ? `- ${rec.note}` : ''}</p>
                         </div>
                       </div>
                     )})}
                     {appData.records.filter(r => r.classId === selectedClassId).length === 0 && (
                       <p className="text-center py-10 text-slate-400 text-sm font-medium">尚無計分紀錄</p>
                     )}
                   </div>
                </div>
              </div>
            ) : (
              <EmptyState title="請選擇班級" subtitle="從上方列表或左側選單切換班級以開始計分" icon={<LayoutDashboard size={48}/>} />
            )}
          </div>
        )}

        {/* ---------------- 系統設定 ---------------- */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-6">
            
            {/* 帳號管理置頂：強調雲端自動同步 */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="font-black text-xl mb-2 flex items-center gap-2 text-slate-800">
                 <User size={24} className="text-indigo-600" /> 帳號管理
               </h3>
               <p className="text-sm text-slate-500 mb-6 font-medium">登入 Google 帳號後，您的資料會自動且即時地同步至 Firebase 雲端資料庫，確保資料安全不遺失。</p>
               
               <div className="flex items-center gap-4 mb-6 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                 <div className="w-12 h-12 rounded-full bg-white border border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0">
                    {user?.photoURL && user.uid !== 'local-guest' ? <img src={user.photoURL} alt="avatar" /> : <User className="text-slate-400" size={24} />}
                 </div>
                 <div className="overflow-hidden">
                   <p className="text-base font-bold truncate text-slate-800">{getUserDisplayName(user)}</p>
                   <p className="text-xs text-slate-500 truncate">{user.uid === 'local-guest' ? '目前為訪客模式 (資料僅存本機)' : user.email}</p>
                 </div>
               </div>

               <button onClick={handleLogout} className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 flex items-center justify-center gap-2 transition-colors">
                 <LogOut size={20} /> {user.uid === 'local-guest' ? '登出訪客模式' : '登出系統'}
               </button>
            </div>

            {/* GAS 作為第二備案的區塊 */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="font-black text-xl mb-2 flex items-center gap-2"><Database size={24} className="text-green-600"/> GAS 備用同步方案</h3>
              <p className="text-sm text-slate-500 mb-4 font-medium">這是同步資料的<strong className="text-amber-600">備案第二方案（非必填）</strong>。若您希望額外將資料備份到 Google Sheets 試算表以方便瀏覽，才需要進行設定：</p>
              
              <div className="flex flex-col sm:flex-row gap-2 mb-4">
                <input 
                  type="text" 
                  value={appData.settings.gasUrl || ''} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setAppData(prev => {
                      const next = {...prev, settings: { ...prev.settings, gasUrl: val }};
                      localStorage.setItem('school_moral_v2', JSON.stringify(next));
                      return next;
                    });
                  }}
                  className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 font-medium text-sm focus:border-green-500 outline-none"
                  placeholder="https://script.google.com/macros/s/..."
                />
                <button 
                  onClick={async () => {
                    if (user && user.uid !== 'local-guest') {
                      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), appData.settings);
                    }
                    showNotify("網址已儲存至本機");
                  }}
                  className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-sm hover:bg-slate-200 transition-colors whitespace-nowrap"
                >儲存網址</button>
              </div>

              {/* 上傳與下載按鈕區塊 */}
              <div className="flex flex-col gap-3 mt-6">
                <button 
                  onClick={handleGasManualSync}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-100"
                >
                  <UploadCloud size={20}/> 將手機資料「備份上傳」到 GAS
                </button>

                <button 
                  onClick={handleGasDownload}
                  className="w-full py-4 bg-amber-50 text-amber-700 border border-amber-200 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-amber-100 transition-colors"
                >
                  <FileDown size={20}/> 從 GAS「下載舊資料」並自動修復相容
                </button>
                
                <p className="text-[10px] text-slate-400 text-center mt-1">
                  提示：若點擊下載，系統會自動將舊版的「日期」及「點數」轉換為新版格式。
                </p>
              </div>

              {/* GAS 教學區塊 (包含新版完美相容腳本) */}
              <div className="mt-8 border-t border-slate-100 pt-6">
                <button 
                  onClick={() => setShowGasTutorial(!showGasTutorial)}
                  className="text-sm font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  {showGasTutorial ? <ChevronRight className="rotate-90 transition-transform" size={16}/> : <ChevronRight className="transition-transform" size={16}/>} 
                  如何設定支援「雙向同步」與「Excel 自動分類」的 GAS 程式碼？
                </button>
                
                {showGasTutorial && (
                  <div className="mt-4 bg-slate-50 p-6 rounded-2xl border border-slate-200 text-sm text-slate-700 space-y-4">
                    <p className="font-black text-slate-900">這是一份升級版的 GAS 程式碼，完美結合了舊版的「各班獨立工作表分類」以及新版的「JSON 即時同步」功能。</p>
                    
                    <p className="font-black text-slate-900">1. 在 Google 試算表中，開啟「擴充功能」 {'>'} 「Apps Script」</p>
                    <p className="font-black text-slate-900">2. 貼上以下全新程式碼：</p>
                    <div className="relative group">
                      <pre className="bg-slate-800 text-slate-50 p-4 rounded-xl overflow-x-auto text-xs font-mono leading-relaxed max-h-60 overflow-y-auto">
{`function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dbSheet = ss.getSheetByName('系統資料庫_勿刪');
  var dataStr = "{}";
  if (dbSheet) {
    dataStr = dbSheet.getRange("A1").getValue() || "{}";
  }
  return ContentService.createTextOutput(dataStr).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var data = payload.data || payload;
    if (data) {
      saveDatabase(data);
      updateReadableSheets(data);
    }
    return ContentService.createTextOutput(JSON.stringify({status: 'success'})).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}

function saveDatabase(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('系統資料庫_勿刪');
  if (!sheet) {
    sheet = ss.insertSheet('系統資料庫_勿刪');
    sheet.hideSheet();
  }
  sheet.getRange('A1').setValue(JSON.stringify(data));
}

function updateReadableSheets(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!data.classes) return;
  
  data.classes.forEach(function(cls) {
    var sheet = ss.getSheetByName(cls.name);
    if (!sheet) sheet = ss.insertSheet(cls.name);
    sheet.clear();
    
    var headers = ['日期', '座號', '姓名', '類別', '項目', '分數', '備註'];
    var rows = [headers];
    
    var classRecords = data.records.filter(function(r) { return r.classId === cls.id; });
    classRecords.forEach(function(r) {
      var student = data.students.find(function(s) { return s.id === r.studentId; }) || {};
      var typeName = r.type === 'positive' ? '獎勵' : '懲處';
      
      // 處理日期格式
      var dateStr = "";
      if (r.timestamp) {
        var d = new Date(r.timestamp);
        dateStr = d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate();
      } else if (r.date) {
        dateStr = r.date;
      }

      var score = r.score !== undefined ? r.score : (r.points !== undefined ? r.points : 0);
      
      rows.push([dateStr, student.seatNo || '', student.name || '', typeName, r.item || '', score, r.note || '']);
    });
    
    if (rows.length > 1) {
      sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);
    }
  });
}`}
                      </pre>
                      <button 
                        onClick={() => {
                          const code = `function doGet(e) {\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  var dbSheet = ss.getSheetByName('系統資料庫_勿刪');\n  var dataStr = "{}";\n  if (dbSheet) {\n    dataStr = dbSheet.getRange("A1").getValue() || "{}";\n  }\n  return ContentService.createTextOutput(dataStr).setMimeType(ContentService.MimeType.JSON);\n}\n\nfunction doPost(e) {\n  try {\n    var payload = JSON.parse(e.postData.contents);\n    var data = payload.data || payload;\n    if (data) {\n      saveDatabase(data);\n      updateReadableSheets(data);\n    }\n    return ContentService.createTextOutput(JSON.stringify({status: 'success'})).setMimeType(ContentService.MimeType.JSON);\n  } catch (err) {\n    return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);\n  }\n}\n\nfunction saveDatabase(data) {\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  var sheet = ss.getSheetByName('系統資料庫_勿刪');\n  if (!sheet) {\n    sheet = ss.insertSheet('系統資料庫_勿刪');\n    sheet.hideSheet();\n  }\n  sheet.getRange('A1').setValue(JSON.stringify(data));\n}\n\nfunction updateReadableSheets(data) {\n  var ss = SpreadsheetApp.getActiveSpreadsheet();\n  if (!data.classes) return;\n  \n  data.classes.forEach(function(cls) {\n    var sheet = ss.getSheetByName(cls.name);\n    if (!sheet) sheet = ss.insertSheet(cls.name);\n    sheet.clear();\n    \n    var headers = ['日期', '座號', '姓名', '類別', '項目', '分數', '備註'];\n    var rows = [headers];\n    \n    var classRecords = data.records.filter(function(r) { return r.classId === cls.id; });\n    classRecords.forEach(function(r) {\n      var student = data.students.find(function(s) { return s.id === r.studentId; }) || {};\n      var typeName = r.type === 'positive' ? '獎勵' : '懲處';\n      \n      var dateStr = "";\n      if (r.timestamp) {\n        var d = new Date(r.timestamp);\n        dateStr = d.getFullYear() + '/' + (d.getMonth()+1) + '/' + d.getDate();\n      } else if (r.date) {\n        dateStr = r.date;\n      }\n\n      var score = r.score !== undefined ? r.score : (r.points !== undefined ? r.points : 0);\n      \n      rows.push([dateStr, student.seatNo || '', student.name || '', typeName, r.item || '', score, r.note || '']);\n    });\n    \n    if (rows.length > 1) {\n      sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);\n    }\n  });\n}`;
                          navigator.clipboard.writeText(code).then(() => showNotify("程式碼已複製！"));
                        }}
                        className="absolute top-2 right-2 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white rounded-lg text-xs font-bold transition-colors opacity-0 group-hover:opacity-100"
                      >複製程式碼</button>
                    </div>

                    <p className="font-black text-slate-900 text-red-600">3. 重要！必須「建立新版本」</p>
                    <p>在 GAS 編輯器點擊右上角的「部署」 {'>'} 「管理部署作業」，點選鉛筆圖示，在「版本」選擇<strong>「建立新版本」</strong>後點擊部署，這樣新程式碼才會生效！</p>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </main>

      {/* ---------------- Modals ---------------- */}
      <Modal isOpen={modalOpen === 'importClass'} onClose={() => setModalOpen(null)} title="新增班級">
        <ImportClassModal onSave={handleAddClass} showNotify={showNotify} />
      </Modal>

      <Modal isOpen={modalOpen === 'editStudents'} onClose={() => setModalOpen(null)} title="編輯學生名單">
        <EditStudentsModal 
          classId={selectedClassId} 
          students={appData.students.filter(s => s.classId === selectedClassId)} 
          onAdd={(seatNo, name) => handleAddStudent(selectedClassId, seatNo, name)}
          onDelete={handleDeleteStudent}
        />
      </Modal>

      <Modal isOpen={modalOpen === 'score'} onClose={() => setModalOpen(null)} title={multiSelect.length === 1 ? appData.students.find(s=>s.id===multiSelect[0])?.name : `批次給分 (${multiSelect.length}人)`}>
        <ScoreModal onSave={(type, item, pts, note) => handleScore(multiSelect, type, item, pts, note)} />
      </Modal>
    </div>
  );
}

// --- 輔助 UI 組件 ---
const NavButton = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`flex flex-col lg:flex-row items-center gap-1 lg:gap-4 p-3 lg:w-full lg:px-6 rounded-2xl transition-all ${active ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
    {icon}
    <span className="text-[10px] lg:text-sm font-black tracking-wider">{label}</span>
  </button>
);

const EmptyState = ({ title, subtitle, icon }) => (
  <div className="bg-white border-2 border-dashed border-slate-200 rounded-[3rem] p-16 text-center">
    <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-[2rem] flex items-center justify-center mx-auto mb-6">{icon}</div>
    <h3 className="text-xl font-black text-slate-800">{title}</h3>
    <p className="text-slate-400 font-medium mt-1">{subtitle}</p>
  </div>
);

const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white w-full max-w-lg sm:rounded-[2.5rem] rounded-t-[2.5rem] shadow-2xl overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95">
        <div className="flex items-center justify-between p-6 border-b border-slate-50">
          <h3 className="text-xl font-black text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 bg-slate-50 rounded-full text-slate-500"><X size={20}/></button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

// --- 功能 Modal 內容 ---
function ImportClassModal({ onSave, showNotify }) {
  const [className, setClassName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (file && ['.csv', '.xlsx', '.xls'].some(ext => file.name.toLowerCase().endsWith(ext))) {
      setSelectedFile(file);
    } else {
      showNotify("請上傳 .csv 或 .xlsx 格式的檔案！");
    }
  };

  const handleSubmit = async () => {
    if (!className.trim()) {
        showNotify("請輸入班級名稱");
        return;
    }
    if (!selectedFile) {
        onSave({ name: className.trim() }, []);
        return;
    }
    
    setIsImporting(true);
    showNotify("正在掃描名單...");

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }); 
          
          if (!json.length) throw new Error("檔案為空");

          let headerRowIndex = -1, sIdx = -1, nIdx = -1;
          for (let i = 0; i < Math.min(json.length, 10); i++) {
            const row = json[i].map(cell => cell.toString().trim());
            const foundS = row.findIndex(h => h.includes('座號') || h.includes('號碼') || h.includes('學號') || h === 'No');
            const foundN = row.findIndex(h => h.includes('姓名') || h === 'Name');

            if (foundS !== -1 && foundN !== -1) {
              headerRowIndex = i; sIdx = foundS; nIdx = foundN; break; 
            }
          }

          if (headerRowIndex === -1) throw new Error("找不到包含「座號」與「姓名」的標題欄");

          const students = [];
          for (let i = headerRowIndex + 1; i < json.length; i++) {
            const row = json[i];
            const seatNo = row[sIdx]?.toString().trim();
            const name = row[nIdx]?.toString().trim();
            if (seatNo || name) students.push({ seatNo: seatNo || (students.length + 1), name: name || "未命名" });
          }

          if (students.length === 0) throw new Error("沒有找到有效的學生資料");

          onSave({ name: className.trim() }, students);
        } catch (err) { 
          showNotify("匯入失敗：" + err.message); 
          setIsImporting(false); 
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    } catch (err) { 
      showNotify("讀取檔案時發生錯誤"); 
      setIsImporting(false); 
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">1. 班級名稱</label>
        <input autoFocus value={className} onChange={e => setClassName(e.target.value)} placeholder="例如：101班" className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 rounded-2xl p-4 outline-none font-bold transition-all" />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-2">2. 匯入名單 (選填)</label>
        {!selectedFile ? (
          <div onClick={() => fileInputRef.current.click()} className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-2xl p-8 text-center cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-colors">
            <input type="file" ref={fileInputRef} onChange={handleFile} accept=".csv, .xlsx, .xls" className="hidden" />
            <UploadCloud className="w-10 h-10 text-indigo-400 mx-auto mb-2" />
            <p className="font-bold text-slate-600">點擊上傳 Excel 名單</p>
            <p className="text-xs text-slate-400 mt-1">需包含「座號/學號」與「姓名」</p>
          </div>
        ) : (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 flex justify-between items-center">
            <div className="flex items-center gap-3 overflow-hidden">
              <FileSpreadsheet className="w-8 h-8 text-indigo-600 flex-shrink-0" />
              <span className="font-bold text-indigo-700 truncate">{selectedFile.name}</span>
            </div>
            <button onClick={() => setSelectedFile(null)} className="p-2 bg-white rounded-full text-slate-400 hover:text-red-500 shadow-sm transition-colors"><X size={16}/></button>
          </div>
        )}
      </div>
      <button onClick={handleSubmit} disabled={!className || isImporting} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg disabled:opacity-50 flex justify-center items-center gap-2 transition-all active:scale-95">
        {isImporting ? <RefreshCw className="animate-spin w-5 h-5"/> : <CheckCircle2 size={20}/>} 
        {selectedFile ? '匯入並建立' : '建立空班級'}
      </button>
    </div>
  );
}

function EditStudentsModal({ classId, students, onAdd, onDelete }) {
  const [newSeat, setNewSeat] = useState('');
  const [newName, setNewName] = useState('');

  const addStudent = () => {
    if (!newSeat || !newName) return;
    onAdd(newSeat, newName);
    setNewSeat(''); setNewName('');
  };

  return (
    <div className="space-y-6">
      <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100 flex gap-2">
        <input type="number" value={newSeat} onChange={e=>setNewSeat(e.target.value)} placeholder="座號" className="w-20 p-3 rounded-xl border border-white font-bold outline-none text-center" />
        <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="轉入生姓名" className="flex-1 p-3 rounded-xl border border-white font-bold outline-none" />
        <button onClick={addStudent} disabled={!newSeat||!newName} className="bg-indigo-600 text-white px-4 rounded-xl font-bold disabled:opacity-50 active:scale-95 transition-transform"><Plus size={20}/></button>
      </div>
      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-2 max-h-[300px] overflow-y-auto">
        {students.sort((a,b)=> (parseInt(a.seatNo)||0)-(parseInt(b.seatNo)||0)).map(s => (
          <div key={s.id} className="flex justify-between items-center p-3 bg-white mb-2 rounded-xl shadow-sm border border-slate-100">
            <div className="flex gap-3 items-center">
              <span className="w-8 text-center text-xs font-black text-slate-400 bg-slate-50 py-1 rounded-md">{s.seatNo}</span>
              <span className="font-bold text-slate-700">{s.name}</span>
            </div>
            <button onClick={() => onDelete(s.id)} className="text-slate-300 hover:text-red-500 p-1.5 transition-colors"><Trash2 size={16}/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoreModal({ onSave }) {
  const [type, setType] = useState('positive'); 
  const [item, setItem] = useState('');
  const [pts, setPts] = useState(1);
  const [note, setNote] = useState('');
  const isPos = type === 'positive';
  const list = isPos ? CATEGORIES.positive : CATEGORIES.negative;

  return (
    <div className="space-y-6">
      <div className="flex bg-slate-100 p-1 rounded-2xl">
        <button onClick={() => { setType('positive'); setItem(''); setPts(1); }} className={`flex-1 py-3 rounded-xl font-black transition flex items-center justify-center gap-2 ${isPos ? 'bg-white text-green-600 shadow-sm' : 'text-slate-400'}`}><ThumbsUp size={18}/> 獎勵</button>
        <button onClick={() => { setType('negative'); setItem(''); setPts(1); }} className={`flex-1 py-3 rounded-xl font-black transition flex items-center justify-center gap-2 ${!isPos ? 'bg-white text-red-600 shadow-sm' : 'text-slate-400'}`}><ThumbsDown size={18}/> 懲處</button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {list.map(i => (
          <button key={i} onClick={() => setItem(i)} className={`py-3 px-1 text-xs font-bold rounded-xl border-2 transition ${item === i ? (isPos ? 'bg-green-50 border-green-500 text-green-700' : 'bg-red-50 border-red-500 text-red-700') : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'}`}>
            {i}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between bg-slate-50 p-4 rounded-2xl border border-slate-100">
        <span className="font-black text-slate-700">設定配分</span>
        <div className="flex items-center gap-4">
          <button onClick={() => setPts(Math.max(1, pts-1))} className="w-10 h-10 bg-white rounded-full shadow-sm font-black active:scale-95 transition-transform">-</button>
          <span className="text-2xl font-black text-indigo-600 w-8 text-center">{pts}</span>
          <button onClick={() => setPts(pts+1)} className="w-10 h-10 bg-white rounded-full shadow-sm font-black active:scale-95 transition-transform">+</button>
        </div>
      </div>
      <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="備註事項 (選填)..." className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-indigo-500 text-sm font-medium transition-all" />
      <button onClick={() => onSave(type, item, pts, note)} disabled={!item} className={`w-full py-4 rounded-2xl font-black text-white text-lg shadow-lg active:scale-95 flex justify-center items-center gap-2 transition-all ${!item ? 'bg-slate-300 shadow-none' : (isPos ? 'bg-green-600' : 'bg-red-600')}`}>
        <Save size={20}/> 確認儲存
      </button>
    </div>
  );
}