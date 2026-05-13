import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Plus, Minus, Users, Settings, Save, RefreshCw, Trash2, 
  ChevronRight, ChevronLeft, MoreHorizontal, LogOut, Cloud, 
  CloudOff, CheckCircle2, AlertCircle, User, LogIn, ShieldCheck,
  Check, X, ClipboardList, UserPlus, GraduationCap
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, 
  signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut,
  signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, getDoc, collection, onSnapshot, 
  query, where, deleteDoc, writeBatch, serverTimestamp 
} from 'firebase/firestore';

// --- 1. 共用常數與預設資料 (Constants) ---
const SCORE_OPTIONS = [
  { label: '準時進教室', value: 1, icon: '⏰' },
  { label: '主動打掃', value: 2, icon: '🧹' },
  { label: '作業優良', value: 2, icon: '📝' },
  { label: '熱心助人', value: 1, icon: '🤝' },
  { label: '早自習安靜', value: 1, icon: '🤫' },
  { label: '課堂遲到', value: -1, icon: '🏃' },
  { label: '作業未交', value: -2, icon: '❌' },
  { label: '服裝不整', value: -1, icon: '👕' },
  { label: '打掃不認真', value: -1, icon: '🗑️' },
];

const DEFAULT_STUDENTS = [
  "王小明", "李小華", "張大同", "陳阿美", "林小強", "趙小雅", "孫大志", "周曉雲"
];

// --- 2. Firebase 初始化 (加入防護與金鑰) ---
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
const repairData = (data) => {
  const defaultData = { classes: [], settings: { schoolName: "" }, lastSync: null };
  if (!data || typeof data !== 'object') return defaultData;
  const repaired = { ...defaultData, ...data };
  repaired.classes = (repaired.classes || []).map(cls => ({
    id: cls.id || Date.now().toString() + Math.random().toString(36).substr(2, 5),
    name: cls.name || "未命名班級",
    students: (cls.students || []).map(st => ({
      id: st.id || Math.random().toString(36).substr(2, 9),
      name: st.name || "未命名學生",
      score: typeof st.score === 'number' ? st.score : 0
    }))
  }));
  return repaired;
};

// --- 4. 主要元件 (App) ---
export default function App() {
  // 核心驗證狀態
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  // 應用程式資料狀態
  const [appData, setAppData] = useState({ classes: [], settings: { schoolName: "" }, lastSync: null });
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedClassId, setSelectedClassId] = useState(null);
  const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, success, error

  // UI 互動狀態 (手機版優化功能)
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState([]);
  const [modalOpen, setModalOpen] = useState(null); // 'score', 'addClass', 'addStudent'

  // ----------------------------------------------------------------
  // A. 驗證與資料初始化 (Auth Lifecycle)
  // ----------------------------------------------------------------
  useEffect(() => {
    // 1. 本地快取讀取
    const cached = localStorage.getItem('school_moral_v2');
    if (cached) {
      try { setAppData(repairData(JSON.parse(cached))); } catch (e) { console.error(e); }
    }

    // 2. 處理跳轉登入結果
    getRedirectResult(auth).catch(err => console.error("Redirect Error:", err));

    // 3. 狀態監聽
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setAuthLoading(false);
      if (u) {
        setUser(u);
        if (!u.isAnonymous) fetchCloudData(u.uid);
      } else {
        setUser(null);
        // 環境支援自動 Token 登入時才處理
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
      }
    } catch (err) { setSyncStatus('error'); }
  };

  const saveState = useCallback((newData) => {
    setAppData(newData);
    localStorage.setItem('school_moral_v2', JSON.stringify(newData));
    
    // 如果已登入，非同步儲存至雲端
    if (user) {
      setSyncStatus('syncing');
      const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'data', 'main');
      setDoc(docRef, { ...newData, lastSync: serverTimestamp() })
        .then(() => {
          setSyncStatus('success');
          setTimeout(() => setSyncStatus('idle'), 2000);
        })
        .catch(() => setSyncStatus('error'));
    }
  }, [user]);

  // ----------------------------------------------------------------
  // C. 驗證動作
  // ----------------------------------------------------------------
  const handleGoogleLogin = async () => {
    setAuthLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
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
      setAppData({ classes: [], settings: { schoolName: "" }, lastSync: null });
      localStorage.removeItem('school_moral_v2');
      setUser(null);
    }
  };

  // ----------------------------------------------------------------
  // D. 業務邏輯 (學生與評分管理)
  // ----------------------------------------------------------------
  const activeClass = useMemo(() => 
    appData.classes.find(c => c.id === selectedClassId) || null
  , [appData.classes, selectedClassId]);

  const toggleStudentSelection = (id) => {
    setSelectedStudents(prev => 
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const handleBatchScore = (value) => {
    const targetIds = isSelectionMode ? selectedStudents : [selectedStudents[0]];
    if (targetIds.length === 0) return;

    const newClasses = appData.classes.map(cls => {
      if (cls.id !== selectedClassId) return cls;
      return {
        ...cls,
        students: cls.students.map(st => 
          targetIds.includes(st.id) ? { ...st, score: st.score + value } : st
        )
      };
    });

    saveState({ ...appData, classes: newClasses });
    setModalOpen(null);
    setIsSelectionMode(false);
    setSelectedStudents([]);
  };

  const addClass = (name) => {
    const newClass = {
      id: Date.now().toString(),
      name,
      students: DEFAULT_STUDENTS.map(n => ({
        id: Math.random().toString(36).substr(2, 9),
        name: n,
        score: 0
      }))
    };
    const newData = { ...appData, classes: [...appData.classes, newClass] };
    saveState(newData);
    setSelectedClassId(newClass.id);
  };

  // ----------------------------------------------------------------
  // E. 渲染元件
  // ----------------------------------------------------------------

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <RefreshCw className="w-12 h-12 text-indigo-600 animate-spin" />
      </div>
    );
  }

  // 登入牆 (Auth Guard)
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4">
        <div className="bg-white p-10 rounded-[3rem] shadow-xl max-w-sm w-full text-center space-y-8 border border-slate-100">
          <div className="flex justify-center">
            <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
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
              className="w-full py-4 bg-white text-slate-700 border-2 border-slate-100 rounded-2xl font-bold active:scale-95 transition-all flex justify-center items-center gap-3"
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
    <div className="min-h-screen bg-slate-50 pb-28 lg:pb-0 lg:pl-64 flex flex-col">
      
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
            <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center overflow-hidden">
              {user.photoURL ? <img src={user.photoURL} alt="avatar" /> : <User className="text-slate-300" />}
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{user.displayName || '老師'}</p>
              <p className="text-[10px] text-slate-400 truncate">{user.isAnonymous ? '訪客身分' : user.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full py-2 text-red-500 text-sm font-bold hover:bg-red-50 rounded-xl flex items-center justify-center gap-2">
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
      <header className="sticky top-0 bg-white/80 backdrop-blur-md border-b border-slate-100 px-6 py-4 flex justify-between items-center z-40">
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
        
        {activeTab === 'dashboard' && (
          <button 
            onClick={() => {
              setIsSelectionMode(!isSelectionMode);
              setSelectedStudents([]);
            }}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              isSelectionMode ? 'bg-indigo-600 text-white shadow-md' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isSelectionMode ? '取消選取' : '多選模式'}
          </button>
        )}
      </header>

      {/* 主內容區 */}
      <main className="flex-1 p-4 lg:p-10">
        {activeTab === 'dashboard' && (
          <div className="max-w-4xl mx-auto space-y-6">
            {/* 班級切換 */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
              {appData.classes.map(cls => (
                <button
                  key={cls.id}
                  onClick={() => setSelectedClassId(cls.id)}
                  className={`px-5 py-2.5 rounded-2xl font-bold text-sm whitespace-nowrap border-2 transition-all ${
                    selectedClassId === cls.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-400'
                  }`}
                >
                  {cls.name}
                </button>
              ))}
              <button 
                onClick={() => setModalOpen('addClass')}
                className="px-5 py-2.5 rounded-2xl font-bold text-sm whitespace-nowrap bg-indigo-50 text-indigo-600 flex items-center gap-2"
              >
                <Plus size={16} /> 新增
              </button>
            </div>

            {/* 學生卡片網格 (手機版優化) */}
            {activeClass ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
                {activeClass.students.map(st => (
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
                        : 'border-white bg-white shadow-sm hover:shadow-md'
                    }`}
                  >
                    {isSelectionMode && (
                      <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center border-2 ${
                        selectedStudents.includes(st.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200'
                      }`}>
                        {selectedStudents.includes(st.id) && <Check size={14} />}
                      </div>
                    )}
                    <span className={`text-2xl font-black ${st.score >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {st.score}
                    </span>
                    <span className="font-bold text-slate-700 truncate w-full">{st.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-20 text-center">
                <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                  <GraduationCap size={40} />
                </div>
                <p className="text-slate-400 font-bold">尚未建立任何班級</p>
              </div>
            )}
          </div>
        )}

        {/* 班級管理分頁 */}
        {activeTab === 'classes' && (
          <div className="max-w-2xl mx-auto space-y-4">
            <div className="bg-white p-6 rounded-[2.5rem] shadow-sm">
              <h3 className="font-black text-lg mb-4 flex items-center gap-2">
                <Users size={20} className="text-indigo-600" /> 現有班級
              </h3>
              <div className="space-y-2">
                {appData.classes.map(cls => (
                  <div key={cls.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl group">
                    <div>
                      <p className="font-bold text-slate-800">{cls.name}</p>
                      <p className="text-xs text-slate-400 font-medium">成員：{cls.students.length} 位學生</p>
                    </div>
                    <button 
                      onClick={() => {
                        if (window.confirm(`確定刪除 ${cls.name}？`)) {
                          saveState({ ...appData, classes: appData.classes.filter(c => c.id !== cls.id) });
                        }
                      }}
                      className="p-2 text-red-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 浮動多選動作條 */}
      {isSelectionMode && selectedStudents.length > 0 && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-3 rounded-full flex items-center gap-6 shadow-2xl z-50 animate-in slide-in-from-bottom-10">
          <span className="text-sm font-black whitespace-nowrap">已選取 {selectedStudents.length} 人</span>
          <button 
            onClick={() => setModalOpen('score')}
            className="bg-indigo-500 px-5 py-1.5 rounded-full font-bold text-sm"
          >
            批次評分
          </button>
          <button onClick={() => { setIsSelectionMode(false); setSelectedStudents([]); }} className="text-slate-400">
            <X size={20} />
          </button>
        </div>
      )}

      {/* Modals */}
      {modalOpen === 'score' && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-[100] p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl animate-in slide-in-from-bottom-full">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black text-slate-800">
                {isSelectionMode ? `批次評分 (${selectedStudents.length}人)` : '學生評分'}
              </h3>
              <button onClick={() => setModalOpen(null)} className="p-2 bg-slate-100 rounded-full text-slate-400">
                <X size={24} />
              </button>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {SCORE_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => handleBatchScore(opt.value)}
                  className={`flex flex-col items-center justify-center gap-2 p-5 rounded-3xl border-2 transition-all active:scale-95 ${
                    opt.value > 0 ? 'border-green-50 hover:border-green-100 bg-green-50/30' : 'border-red-50 hover:border-red-100 bg-red-50/30'
                  }`}
                >
                  <span className="text-3xl">{opt.icon}</span>
                  <span className="text-sm font-black text-slate-700">{opt.label}</span>
                  <span className={`text-xs font-black px-2 py-0.5 rounded-full ${opt.value > 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                    {opt.value > 0 ? `+${opt.value}` : opt.value}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {modalOpen === 'addClass' && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-6">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl">
            <h3 className="text-2xl font-black mb-6">新增班級</h3>
            <input 
              id="clsInput"
              autoFocus
              placeholder="例如: 3年8班"
              className="w-full bg-slate-50 border-2 border-slate-50 focus:border-indigo-500 rounded-2xl p-4 mb-6 outline-none font-bold"
            />
            <div className="flex gap-3">
              <button onClick={() => setModalOpen(null)} className="flex-1 py-4 font-bold text-slate-400">取消</button>
              <button 
                onClick={() => {
                  const val = document.getElementById('clsInput').value;
                  if (val) addClass(val);
                  setModalOpen(null);
                }}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold"
              >
                建立班級
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}