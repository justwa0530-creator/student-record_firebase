import React, { useState, useRef, useEffect, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInWithCustomToken, 
  onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut 
} from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, getDoc, serverTimestamp } from 'firebase/firestore';
import { 
  Users, Plus, UploadCloud, FileSpreadsheet, Info, CheckCircle2,
  ArrowLeft, X, Cloud, ChevronRight, AlertTriangle, Loader2, Save,
  ThumbsUp, ThumbsDown, Trash2, LayoutGrid, Table as TableIcon, 
  FileDown, CheckSquare, Search, CloudOff, User, LogOut, UserCog,
  Database, RefreshCw, Send
} from 'lucide-react';
import * as XLSX from 'xlsx';

// ==========================================
// 🔴 老師請注意：請在此填入您的 Firebase 設定 🔴
// ==========================================
const userFirebaseConfig = {
  apiKey: "AIzaSyAAu801RjoYkki3JEOw1WPQDGBHxLqAy3U",
  authDomain: "student-record-10391.firebaseapp.com",
  projectId: "student-record-10391",
  storageBucket: "student-record-10391.firebasestorage.app",
  messagingSenderId: "93081425564",
  appId: "1:93081425564:web:10ca88c855b46ef800bf59",
  measurementId: "G-YGE2HJHNQ9"
};

// 1. 修復 Firebase 重複初始化問題
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : userFirebaseConfig;
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'moral-system-pro';

// 6. 安全的 JSON.parse 處理
const safeParse = (str, fallback = {}) => {
  if (!str) return fallback;
  try {
    return JSON.parse(str) || fallback;
  } catch {
    return fallback;
  }
};

// ==========================================
// 共用常數與預設資料
// ==========================================
const CATEGORIES = {
  positive: ['遵守秩序', '課業優良', '值日盡責', '整齊清潔', '服儀端正', '禮節週到', '熱心公務', '其他獎勵'],
  negative: ['秩序欠佳', '欠繳作業', '工作怠惰', '環境髒亂', '缺乏責任感', '言行不當', '遲到', '其他處罰']
};

const repairData = (data) => {
  if (!data) return { classes: [], students: [], records: [] };
  const classes = data.classes || [];
  const students = (data.students || []).map(s => {
    const matchedClass = classes.find(c => c.name === s.classId || c.id === s.classId);
    return { ...s, classId: matchedClass ? matchedClass.id : s.classId, seatNo: s.seatNo || s.no || '' };
  });
  const records = (data.records || []).map(r => {
    const matchedClass = classes.find(c => c.name === r.classId || c.id === r.classId);
    return { ...r, classId: matchedClass ? matchedClass.id : r.classId };
  });
  return { classes, students, records };
};

// ==========================================
// 主應用程式 App
// ==========================================
export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [currentView, setCurrentView] = useState('dashboard'); 
  const [appData, setAppData] = useState({ classes: [], students: [], records: [] });
  const [selectedClass, setSelectedClass] = useState(null);
  const [notification, setNotification] = useState(null);
  const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [syncStatus, setSyncStatus] = useState('idle');
  
  const appDataRef = useRef(appData);
  useEffect(() => {
    appDataRef.current = appData;
  }, [appData]);

  // ------------------------------------------
  // 7. 防 Memory Leak：統一管理 setTimeout (只保留這一個！)
  // ------------------------------------------
  const timeoutRef = useRef(null);
  const resetSyncStatus = (delay = 3000) => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setSyncStatus('idle');
    }, delay);
  };
  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  // ------------------------------------------
  // ★ 核心修復：Firebase 初始化與登入狀態還原 ★
  // ------------------------------------------
  useEffect(() => {
    const localData = localStorage.getItem('school_moral_data');
    if (localData) {
      setAppData(repairData(safeParse(localData)));
    }
    const savedUrl = localStorage.getItem('gas_api_url');
    if (savedUrl) setApiUrl(savedUrl);

    const initAuth = async () => {
      try {
        if (auth.authStateReady) {
          await auth.authStateReady();
        }
        await getRedirectResult(auth).catch(() => {});
        
        authInitRef.current = true;
      } catch (err) {
        console.error("初始化驗證失敗", err);
        authInitRef.current = true;
      }
    };

    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!authInitRef.current) return;

      if (u) {
        setUser(u);
        setAuthLoading(false);
        
        try {
          const docRef = doc(db, 'artifacts', appId, 'users', u.uid, 'schoolData', 'main');
          const snap = await getDoc(docRef);
          
          if (snap.exists()) {
            const cloudData = snap.data();
            const repaired = repairData(cloudData.data);
            repaired.updatedAtLocal = cloudData.updatedAtLocal || Date.now();
            setAppData(repaired);
            localStorage.setItem('school_moral_data', JSON.stringify(repaired));
          } else {
            const local = safeParse(localStorage.getItem('school_moral_data'), {});
            if (local.classes && local.classes.length > 0) {
              const localTime = Date.now();
              await setDoc(docRef, {
                data: local,
                updatedAt: serverTimestamp(),
                updatedAtLocal: localTime
              });
            }
          }
        } catch (err) {
          console.error("處理雲端資料轉移失敗", err);
        }
      } else {
        // 🚀 核心修改：徹底移除匿名登入，沒有帳號就是未登入
        setUser(null);
        setAuthLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // 監聽 Firebase 資料庫變化 (防 Snapshot 競爭)
  useEffect(() => {
    if (!user) return; // 🚀 修改：直接判斷是否登入
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schoolData', 'main');
    
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const cloudDoc = docSnap.data();
        const localDoc = safeParse(localStorage.getItem('school_moral_data'), {});
        
        if (!localDoc.updatedAtLocal || (cloudDoc.updatedAtLocal && cloudDoc.updatedAtLocal > localDoc.updatedAtLocal)) {
          const repaired = repairData(cloudDoc.data);
          repaired.updatedAtLocal = cloudDoc.updatedAtLocal;
          setAppData(repaired);
          localStorage.setItem('school_moral_data', JSON.stringify(repaired));
          setSyncStatus('success');
          resetSyncStatus();
        }
      }
    }, (error) => {
      console.error(error);
      setSyncStatus('error');
    });

    return () => unsubscribe();
  }, [user]);

  // 儲存資料 (自動推送到 Firebase 與 GAS)
  const saveAppData = async (newData) => {
    const localTime = Date.now();
    const dataToSave = { ...repairData(newData), updatedAtLocal: localTime };
    
    setAppData(dataToSave); 
    localStorage.setItem('school_moral_data', JSON.stringify(dataToSave)); 
    
    let hasError = false;
    setSyncStatus('syncing');

    if (user) { // 🚀 修改：直接判斷是否登入
      try {
        const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schoolData', 'main');
        await setDoc(docRef, { 
          data: dataToSave, 
          updatedAt: serverTimestamp(), 
          updatedAtLocal: localTime     
        });
      } catch (err) {
        console.error("寫入雲端失敗", err);
        hasError = true;
      }
    }

    if (apiUrl) {
      try {
        const res = await fetch(apiUrl, {
          method: 'POST',
          body: JSON.stringify({ data: dataToSave }),
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        });
        if (!res.ok) throw new Error('GAS Sync failed');
      } catch (err) {
        console.error("GAS 寫入失敗", err);
        hasError = true;
      }
    }

    if (hasError) {
      setSyncStatus('error');
    } else if (user || apiUrl) { // 🚀 修改：直接判斷是否登入
      setSyncStatus('success');
      resetSyncStatus(2000);
    } else {
      setSyncStatus('idle'); 
    }
  };

  const fetchFromGasCloud = async (url) => {
    setSyncStatus('syncing');
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error('Network response was not ok');
      const cloudData = await res.json();
      if (cloudData && cloudData.classes) {
        const repaired = repairData(cloudData);
        repaired.updatedAtLocal = Date.now();
        setAppData(repaired);
        localStorage.setItem('school_moral_data', JSON.stringify(repaired));
        setSyncStatus('success');
        showNotification('成功從 Google Sheet 下載最新資料！');
        
        if (user) { // 🚀 修改：直接判斷是否登入
           const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'schoolData', 'main');
           await setDoc(docRef, { 
             data: repaired, 
             updatedAt: serverTimestamp(),
             updatedAtLocal: repaired.updatedAtLocal 
           });
        }
      }
    } catch (err) {
      console.error('下載錯誤詳情：', err);
      setSyncStatus('error');
      showNotification('Google Sheet 下載失敗，請檢查網址設定。');
    }
    resetSyncStatus();
  };

  const handleAddClass = (classData, students) => {
    const newClass = { id: Date.now().toString(), name: classData.name, year: classData.year };
    const newStudents = students.map(s => ({
      id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      classId: newClass.id, seatNo: s.seatNo, name: s.name
    }));
    saveAppData({
      ...appData, classes: [...appData.classes, newClass], students: [...appData.students, ...newStudents]
    });
    setCurrentView('dashboard');
    showNotification(`已新增班級「${newClass.name}」`);
  };

  const handleUpdateStudents = (classId, updatedStudents) => {
    const otherStudents = appData.students.filter(s => s.classId !== classId);
    saveAppData({
      ...appData,
      students: [...otherStudents, ...updatedStudents]
    });
    showNotification('名單已更新並同步至雲端！');
  };

  const handleAddRecords = (newRecordsArray) => {
    const recordsWithId = newRecordsArray.map(r => ({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7), ...r
    }));
    saveAppData({ ...appData, records: [...appData.records, ...recordsWithId] });
    showNotification(newRecordsArray.length === 1 ? `已為 ${newRecordsArray[0].studentName} 新增紀錄！` : `批次完成！已新增 ${newRecordsArray.length} 筆紀錄`);
  };

  const handleDeleteClass = (classId) => {
    saveAppData({
      classes: appData.classes.filter(c => c.id !== classId),
      students: appData.students.filter(s => s.classId !== classId),
      records: appData.records.filter(r => r.classId !== classId)
    });
    showNotification("班級與相關紀錄已成功刪除");
    setCurrentView('dashboard');
  };

  const showNotification = (msg) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  if (authLoading) {
    return <div className="min-h-screen flex flex-col items-center justify-center font-bold text-indigo-600 gap-3"><Loader2 className="animate-spin w-8 h-8" /> 系統資料同步中...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 font-sans pb-24 select-none">
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600 cursor-pointer" onClick={() => setCurrentView('dashboard')}>
            <Users className="w-6 h-6" />
            <span className="font-bold text-lg tracking-wide">品德管理系統</span>
          </div>
          <div className="flex items-center gap-3">
            {syncStatus === 'syncing' && <Loader2 className="w-5 h-5 text-indigo-500 animate-spin" />}
            {syncStatus === 'success' && <Cloud className="w-5 h-5 text-green-500" />}
            {syncStatus === 'error' && <CloudOff className="w-5 h-5 text-red-500" />}
            
            <button 
              onClick={() => setIsCloudModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-full transition active:scale-95 text-sm font-bold text-gray-600"
            >
              {!user ? <User className="w-4 h-4"/> : <CheckCircle2 className="w-4 h-4 text-green-600"/>}
              {!user ? '未登入' : '已登入'}
            </button>
          </div>
        </div>
      </header>

      {notification && (
        <div className="fixed top-16 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white px-5 py-2.5 rounded-full shadow-lg flex items-center gap-2 z-50 transition-all animate-in slide-in-from-top-2 text-sm font-bold">
          <CheckCircle2 className="w-4 h-4 text-green-400" />
          <span>{notification}</span>
        </div>
      )}

      {isCloudModalOpen && (
        <DualCloudSettingsModal 
          user={user}
          apiUrl={apiUrl}
          setApiUrl={(url) => { setApiUrl(url); localStorage.setItem('gas_api_url', url); }}
          onClose={() => setIsCloudModalOpen(false)}
          onFetchFromGas={() => fetchFromGasCloud(apiUrl)}
          onForcePush={() => {
            saveAppData(appDataRef.current);
            showNotification("已觸發強制同步上傳！");
          }}
        />
      )}

      <main className="max-w-6xl mx-auto px-4 py-6">
        {currentView === 'dashboard' && (
          <Dashboard 
            classes={appData.classes} students={appData.students}
            onAddClick={() => setCurrentView('import')} 
            onEnterClass={(cls) => { setSelectedClass(cls); setCurrentView('management'); }}
            onDeleteClass={handleDeleteClass}
          />
        )}
        
        {currentView === 'import' && (
          <ImportInstructionsView onCancel={() => setCurrentView('dashboard')} onProceed={() => setCurrentView('add-class')} />
        )}

        {currentView === 'add-class' && (
          <AddClassView onBack={() => setCurrentView('import')} onSave={handleAddClass} onNotify={showNotification} />
        )}

        {currentView === 'management' && selectedClass && (
          <ClassManagementView 
            classData={selectedClass} 
            students={appData.students.filter(s => s.classId === selectedClass.id)}
            records={appData.records.filter(r => r.classId === selectedClass.id)}
            onBack={() => { setCurrentView('dashboard'); setSelectedClass(null); }} 
            onAddRecords={handleAddRecords}
            onUpdateStudents={handleUpdateStudents}
          />
        )}
      </main>
    </div>
  );
}

// ==========================================
// 雙重雲端同步設定面板 (Firebase + GAS)
// ==========================================
function DualCloudSettingsModal({ user, apiUrl, setApiUrl, onClose, onFetchFromGas, onForcePush }) {
  const [loading, setLoading] = useState(false);
  const [tempUrl, setTempUrl] = useState(apiUrl);

  const handleGoogleLogin = async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' }); 
    try {
      const hostname = window.location.hostname;
      const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
      const isLocal = ['localhost', '127.0.0.1'].includes(hostname) || hostname.includes('webcontainer.io');
      
      if (isLocal && !isMobile) {
        await signInWithPopup(auth, provider);
        onClose(); 
      } else {
        await signInWithRedirect(auth, provider);
      }
    } catch (error) {
      if (error.code === 'auth/unauthorized-domain') {
        alert("⚠️ 網域未授權錯誤！\n\n請到 Firebase 後台 -> Authentication -> Settings -> Authorized domains 中新增目前網址！");
      } else if (error.code === 'auth/admin-restricted-operation' || error.message.includes('restricted')) {
        alert("登入失敗：您的學校帳號 (@go.edu.tw) 可能阻擋了登入，請改用一般 Gmail 帳號測試。");
      } else {
        alert("登入發生錯誤：" + error.message);
      }
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      await signOut(auth);
      // 🚀 核心修改：登出後就維持未登入狀態，不再觸發匿名
    } catch (error) {
      alert("登出發生錯誤：" + error.message);
    }
    setLoading(false);
  };

  const handleSaveGas = () => {
    setApiUrl(tempUrl);
    alert("Google Sheet 網址已儲存！");
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex flex-col justify-end sm:justify-center items-center z-50 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="bg-indigo-600 px-6 py-5 flex justify-between items-center text-white flex-shrink-0">
          <h2 className="text-lg font-bold flex items-center gap-2"><Cloud className="w-6 h-6" /> 同步與備份設定</h2>
          <button onClick={onClose} className="p-1 text-indigo-200 hover:text-white rounded-full active:scale-95"><X className="w-6 h-6" /></button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <Database className="w-5 h-5 text-indigo-500" />
              <h3 className="font-black text-gray-900">方案 A：Google 帳號綁定</h3>
            </div>
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-xs font-bold mb-4 border border-red-100">
              ⚠️ 建議使用「一般 Gmail」。登入後將固定 UID，跨裝置同步不再錯亂。
            </div>
            
            <div className="bg-gray-50 rounded-xl p-4 flex items-center justify-between mb-4">
               <div className="flex items-center gap-3 overflow-hidden">
                 <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {user?.photoURL ? (
                      <img src={user.photoURL} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                      <User className={`w-5 h-5 ${!user ? 'text-gray-400' : 'text-indigo-600'}`} />
                    )}
                 </div>
                 <div className="overflow-hidden">
                   <div className="font-black text-sm text-gray-900 truncate">
                     {!user ? '目前為本機模式 (未連線雲端)' : (user?.displayName || '已登入')}
                   </div>
                   <div className="text-xs text-gray-500 font-bold truncate w-48 sm:w-56">
                     {!user ? '資料僅存本機，請登入以自動備份' : user?.email}
                   </div>
                 </div>
               </div>
            </div>

            {user && (
              <button 
                onClick={() => { onForcePush(); onClose(); }}
                className="w-full py-3 mb-4 rounded-xl font-black text-white bg-green-600 shadow-md active:scale-95 transition flex items-center justify-center gap-2"
              >
                <Send className="w-5 h-5"/> 立即強制同步上傳
              </button>
            )}

            {!user ? (
              <button onClick={handleGoogleLogin} disabled={loading} className="w-full py-3 rounded-xl font-black text-white bg-indigo-600 shadow-md active:scale-95 transition flex items-center justify-center gap-2">
                {loading ? <Loader2 className="animate-spin w-5 h-5"/> : <Cloud className="w-5 h-5"/>} 登入個人 Google 帳號
              </button>
            ) : (
              <div className="flex gap-2">
                <button onClick={handleLogout} disabled={loading} className="flex-1 py-3 rounded-xl font-black text-red-600 bg-red-50 active:scale-95 transition flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin w-5 h-5"/> : <LogOut className="w-5 h-5"/>} 登出
                </button>
                <button onClick={handleGoogleLogin} disabled={loading} className="flex-1 py-3 rounded-xl font-black text-indigo-600 bg-indigo-50 active:scale-95 transition flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin w-5 h-5"/> : <RefreshCw className="w-5 h-5"/>} 切換帳號
                </button>
              </div>
            )}
          </div>

          <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 mb-4">
              <FileSpreadsheet className="w-5 h-5 text-green-500" />
              <h3 className="font-black text-gray-900">方案 B：Google Sheet 備份</h3>
            </div>
            <p className="text-xs text-gray-500 font-bold mb-4">將資料寫入指定的 Google 試算表中保存。可與方案 A 同時啟用作為雙重備份。</p>
            
            <div className="space-y-3">
              <input 
                type="text" value={tempUrl} onChange={(e) => setTempUrl(e.target.value)}
                placeholder="貼上 Apps Script 部署網址 (https://script.google.com/...)"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-green-500 focus:ring-1 focus:ring-green-500 text-sm font-medium"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveGas} className="flex-1 py-3 bg-green-50 text-green-700 rounded-xl font-black active:scale-95 transition">儲存網址</button>
                <button onClick={onFetchFromGas} disabled={!apiUrl} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-black active:scale-95 transition disabled:opacity-50 flex items-center justify-center gap-1">
                  <RefreshCw className="w-4 h-4" /> 從 Sheet 載入
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Dashboard({ classes, students, onAddClick, onEnterClass, onDeleteClass }) {
  const [classToDelete, setClassToDelete] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const confirmDelete = () => {
    if (classToDelete && deleteConfirmText === classToDelete.name) {
      onDeleteClass(classToDelete.id);
      setClassToDelete(null);
      setDeleteConfirmText('');
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">班級列表</h1>
        {classes.length > 0 && (
          <button onClick={onAddClick} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-xl shadow-sm font-bold active:scale-95 transition">
            <Plus className="w-5 h-5" /> 新增
          </button>
        )}
      </div>

      {classes.length === 0 ? (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-10 flex flex-col items-center justify-center text-center">
          <div className="bg-indigo-50 p-4 rounded-full mb-4"><Users className="w-12 h-12 text-indigo-500" /></div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">歡迎使用！</h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed">您目前還沒有建立任何班級。<br/>請先準備好學生的 Excel 或 CSV 名單檔案。</p>
          <button onClick={onAddClick} className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-3.5 rounded-2xl shadow-md font-bold text-lg active:scale-95 transition">
            <Plus className="w-6 h-6" /> 開始匯入班級
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {classes.map((cls) => {
            const stuCount = students.filter((s) => s.classId === cls.id).length;
            return (
              <div key={cls.id} onClick={() => onEnterClass(cls)} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 active:scale-[0.98] cursor-pointer flex flex-col justify-between hover:shadow-md transition">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-black text-xl">{cls.name.charAt(0)}</div>
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{cls.name}</h3>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Users className="w-3 h-3"/> {stuCount} 名學生</p>
                    </div>
                  </div>
                  <button 
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setClassToDelete(cls);
                      setDeleteConfirmText('');
                    }} 
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                <div className="w-full bg-gray-50 text-center py-3 rounded-xl text-sm font-bold text-gray-600 flex items-center justify-center gap-2 mt-2">
                  進入管理 <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {classToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full animate-in zoom-in-95 duration-200 shadow-2xl">
            <h3 className="text-xl font-black text-red-600 flex items-center gap-2 mb-3">
              <AlertTriangle className="w-6 h-6" /> 刪除班級確認
            </h3>
            <div className="bg-red-50 text-red-800 p-3 rounded-xl text-sm font-medium mb-4 leading-relaxed">
              警告：刪除班級將<strong className="font-black">永久移除</strong>該班的所有學生與給分紀錄。
            </div>
            <p className="text-gray-700 text-sm font-bold mb-2">
              請輸入班級名稱 <strong className="text-indigo-600 text-base bg-indigo-50 px-2 py-0.5 rounded">{classToDelete.name}</strong> 以確認刪除：
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={e => setDeleteConfirmText(e.target.value)}
              placeholder="輸入班級名稱"
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl mb-6 outline-none focus:border-red-400 focus:ring-1 focus:ring-red-400 font-bold"
            />
            <div className="flex gap-3">
              <button onClick={() => { setClassToDelete(null); setDeleteConfirmText(''); }} className="flex-1 py-3 bg-gray-100 text-gray-700 rounded-xl font-bold active:scale-95 transition">取消</button>
              <button
                onClick={confirmDelete}
                disabled={deleteConfirmText !== classToDelete.name}
                className="flex-1 py-3 bg-red-600 text-white rounded-xl font-bold disabled:opacity-50 disabled:bg-gray-300 active:scale-95 transition"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportInstructionsView({ onCancel, onProceed }) {
  return (
    <div className="max-w-xl mx-auto animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-lg border border-gray-200 overflow-hidden">
        <div className="bg-indigo-600 px-6 py-5 flex justify-between items-center text-white">
          <h2 className="text-lg font-bold flex items-center gap-2"><Info className="w-5 h-5" /> 名單匯入須知</h2>
          <button onClick={onCancel} className="text-indigo-200 p-1"><X className="w-6 h-6" /></button>
        </div>
        <div className="p-6 space-y-6">
          <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
            <h3 className="font-bold text-blue-900 flex items-center gap-2 mb-2"><CheckCircle2 className="w-5 h-5 text-blue-600" /> 只需「座號」與「姓名」</h3>
            <p className="text-blue-800 text-sm leading-relaxed">Excel (.xlsx) 或 CSV 檔案中，包含這兩個標題即可，系統會自動智慧掃描與忽略其他欄位。</p>
          </div>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 text-xs font-bold text-gray-500">範例</div>
            <table className="w-full text-sm text-left text-gray-600">
              <thead className="bg-white border-b border-gray-100"><tr><th className="px-4 py-2 w-20">座號</th><th className="px-4 py-2">姓名</th></tr></thead>
              <tbody className="bg-white">
                <tr className="border-b border-gray-50"><td className="px-4 py-2">1</td><td className="px-4 py-2">王小明</td></tr>
                <tr><td className="px-4 py-2">2</td><td className="px-4 py-2">李小華</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="p-5 border-t border-gray-100 flex gap-3 bg-gray-50">
          <button onClick={onCancel} className="flex-1 py-3.5 rounded-2xl text-gray-600 font-bold bg-gray-200 active:scale-95">取消</button>
          <button onClick={onProceed} className="flex-[2] py-3.5 rounded-2xl font-bold text-white bg-indigo-600 shadow-md active:scale-95 flex justify-center gap-2 transition">
            開始上傳 <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddClassView({ onBack, onSave, onNotify }) {
  const [className, setClassName] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (file && ['.csv', '.xlsx', '.xls'].some(ext => file.name.toLowerCase().endsWith(ext))) {
      setSelectedFile(file);
    } else {
      onNotify("請上傳 .csv 或 .xlsx 格式的檔案！");
    }
  };

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });

  const handleSubmit = async () => {
    if (!className.trim() || !selectedFile) return;
    setIsImporting(true);
    onNotify("正在智慧掃描名單...");

    try {
      const buffer = await readFile(selectedFile);
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }); 
      
      if (!json.length) throw new Error("檔案為空");

      let headerRowIndex = -1;
      let sIdx = -1;
      let nIdx = -1;

      const scanLimit = Math.min(json.length, 10);
      for (let i = 0; i < scanLimit; i++) {
        const row = json[i].map(cell => cell.toString().trim());
        const foundS = row.findIndex(h => h.includes('座號') || h.includes('號碼') || h.includes('學號') || h === 'No');
        const foundN = row.findIndex(h => h.includes('姓名') || h === 'Name');

        if (foundS !== -1 && foundN !== -1) {
          headerRowIndex = i;
          sIdx = foundS;
          nIdx = foundN;
          break; 
        }
      }

      if (headerRowIndex === -1) {
        throw new Error("找不到包含「座號」與「姓名」的標題，請檢查內容。");
      }

      const students = [];
      for (let i = headerRowIndex + 1; i < json.length; i++) {
        const row = json[i];
        const seatNo = row[sIdx]?.toString().trim();
        const name = row[nIdx]?.toString().trim();

        if (seatNo || name) {
          students.push({ 
            seatNo: seatNo || (students.length + 1), 
            name: name || "未命名" 
          });
        }
      }

      if (students.length === 0) throw new Error("表頭下方沒有找到學生資料");

      onSave({ name: className, year: new Date().getFullYear() - 1911 }, students);
    } catch (err) { 
      onNotify("匯入失敗：" + err.message); 
    } finally {
      setIsImporting(false); 
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 animate-in slide-in-from-right-8 fade-in duration-300">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="p-2 bg-white shadow-sm rounded-full active:scale-95"><ArrowLeft className="w-5 h-5" /></button>
        <h1 className="text-xl font-bold text-gray-900">設定班級與名單</h1>
      </div>
      <div className="bg-white rounded-3xl shadow-sm border border-gray-200 p-6 space-y-8">
        <section>
          <label className="block font-bold text-gray-900 mb-2">1. 班級名稱</label>
          <input type="text" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="例如：101班" className="w-full px-4 py-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-indigo-500 focus:bg-white outline-none font-bold text-lg"/>
        </section>
        <section>
          <label className="block font-bold text-gray-900 mb-2">2. 上傳名單檔案</label>
          {!selectedFile ? (
            <div onClick={() => fileInputRef.current.click()} className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center bg-gray-50 active:bg-gray-100 cursor-pointer">
              <input ref={fileInputRef} type="file" accept=".csv, .xlsx, .xls" onChange={handleFile} className="hidden" />
              <div className="bg-white w-14 h-14 rounded-full shadow-sm flex items-center justify-center mx-auto mb-3"><UploadCloud className="w-7 h-7 text-indigo-500" /></div>
              <p className="font-bold text-gray-900">點擊上傳檔案</p>
            </div>
          ) : (
            <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3"><FileSpreadsheet className="w-8 h-8 text-green-600" /><div><p className="font-bold">{selectedFile.name}</p></div></div>
              <button onClick={() => setSelectedFile(null)} className="p-2 bg-white rounded-full"><X className="w-5 h-5" /></button>
            </div>
          )}
        </section>
        <button onClick={handleSubmit} disabled={!className || !selectedFile || isImporting} className={`w-full py-4 rounded-2xl font-black flex items-center justify-center gap-2 text-lg transition ${(!className || !selectedFile || isImporting) ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white shadow-lg active:scale-95'}`}>
          {isImporting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} 建立班級
        </button>
      </div>
    </div>
  );
}

function ClassManagementView({ classData, students, records, onBack, onAddRecords, onUpdateStudents }) {
  const [viewMode, setViewMode] = useState('grid'); 
  const [searchQuery, setSearchQuery] = useState('');
  const [isMultiMode, setIsMultiMode] = useState(false);
  const [isEditingStudents, setIsEditingStudents] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedStudentsForModal, setSelectedStudentsForModal] = useState([]);

  const studentsWithPoints = students.map((s) => {
    const sRecs = records.filter(r => r.studentId === s.id);
    return { 
      ...s, 
      totalPoints: sRecs.reduce((sum, r) => sum + r.points, 0),
      positivePoints: sRecs.filter(r => r.points > 0).reduce((sum, r) => sum + r.points, 0),
      negativePoints: sRecs.filter(r => r.points < 0).reduce((sum, r) => sum + r.points, 0)
    };
  });

  const filteredStudents = studentsWithPoints.filter(s => s.name.includes(searchQuery) || (s.seatNo||'').toString().includes(searchQuery))
    .sort((a, b) => (parseInt(a.seatNo)||0) - (parseInt(b.seatNo)||0));

  const toggleSelection = (id) => { const n = new Set(selectedIds); n.has(id) ? n.delete(id) : n.add(id); setSelectedIds(n); };
  
  const exportCSV = () => {
    const csv = ['座號,姓名,優點,缺點,總計', ...filteredStudents.map(s => `${s.seatNo},${s.name},${s.positivePoints},${s.negativePoints},${s.totalPoints}`)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = `${classData.name}_總表.csv`;
    a.click();
  };

  return (
    <div className="space-y-4 animate-in slide-in-from-right-4 fade-in duration-300">
      <div className="bg-white p-3 rounded-2xl shadow-sm border border-gray-200 sticky top-14 z-30 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 bg-gray-50 rounded-full active:scale-95 transition"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-xl font-black text-gray-900">{classData.name}</h1>
          </div>
          {!isMultiMode && (
            <div className="flex gap-2">
              <button onClick={() => setIsEditingStudents(true)} className="p-2 bg-blue-50 text-blue-600 rounded-full active:scale-95 transition" title="編輯學生名單">
                <UserCog className="w-5 h-5" />
              </button>
              <button onClick={() => setIsMultiMode(true)} className="p-2 bg-indigo-50 text-indigo-600 rounded-full active:scale-95 transition" title="批次給分">
                <CheckSquare className="w-5 h-5" />
              </button>
              <button onClick={exportCSV} className="p-2 bg-green-50 text-green-600 rounded-full active:scale-95 transition" title="匯出總表">
                <FileDown className="w-5 h-5" />
              </button>
              <button onClick={() => setViewMode(viewMode === 'grid' ? 'table' : 'grid')} className="p-2 bg-gray-100 text-gray-600 rounded-full active:scale-95 transition" title="切換檢視">
                {viewMode === 'grid' ? <TableIcon className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="輸入姓名或座號搜尋..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-gray-50 border-none rounded-xl pl-9 py-2.5 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none" />
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {filteredStudents.map((s) => (
            <div key={s.id} onClick={() => isMultiMode ? toggleSelection(s.id) : setSelectedStudentsForModal([s])} className={`bg-white rounded-2xl p-3 border-2 active:scale-95 cursor-pointer flex flex-col relative transition ${isMultiMode && selectedIds.has(s.id) ? 'border-indigo-500 bg-indigo-50' : 'border-transparent shadow-sm border-gray-100'}`}>
              <div className="flex justify-between items-center mb-2">
                <span className={`text-xs font-black px-2 py-1 rounded-lg ${isMultiMode && selectedIds.has(s.id) ? 'bg-indigo-200 text-indigo-800' : 'bg-gray-100 text-gray-500'}`}>{s.seatNo}</span>
                {isMultiMode && <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${selectedIds.has(s.id) ? 'bg-indigo-500 border-indigo-500' : 'border-gray-200'}`}>{selectedIds.has(s.id) && <CheckCircle2 className="w-4 h-4 text-white" />}</div>}
              </div>
              <h3 className="font-black text-gray-900 text-lg mb-2 text-center">{s.name}</h3>
              <div className="flex gap-1.5 w-full">
                <div className={`flex flex-col items-center flex-1 rounded-xl py-1.5 ${isMultiMode && selectedIds.has(s.id) ? 'bg-white' : 'bg-green-50'}`}>
                  <span className="text-[10px] font-bold text-green-600">優點</span><span className="text-base font-black text-green-700">{s.positivePoints}</span>
                </div>
                <div className={`flex flex-col items-center flex-1 rounded-xl py-1.5 ${isMultiMode && selectedIds.has(s.id) ? 'bg-white' : 'bg-red-50'}`}>
                  <span className="text-[10px] font-bold text-red-500">缺點</span><span className="text-base font-black text-red-600">{Math.abs(s.negativePoints)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-gray-50 border-b border-gray-100 text-xs text-gray-500">
              <tr>{isMultiMode && <th className="px-4 py-3"></th>}<th className="px-4 py-3">座號</th><th className="px-4 py-3">姓名</th><th className="px-4 py-3 text-green-600">優</th><th className="px-4 py-3 text-red-500">缺</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50 font-bold text-gray-700">
              {filteredStudents.map((s) => (
                <tr key={s.id} onClick={() => isMultiMode ? toggleSelection(s.id) : setSelectedStudentsForModal([s])} className={`cursor-pointer transition ${isMultiMode && selectedIds.has(s.id) ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}>
                  {isMultiMode && <td className="px-4 py-3"><div className={`w-5 h-5 rounded border-2 ${selectedIds.has(s.id) ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300'}`}></div></td>}
                  <td className="px-4 py-3">{s.seatNo}</td><td className="px-4 py-3 text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 text-green-600">{s.positivePoints}</td><td className="px-4 py-3 text-red-500">{s.negativePoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isMultiMode && (
        <div className="fixed bottom-6 left-4 right-4 bg-indigo-900 text-white rounded-3xl p-4 shadow-2xl flex justify-between items-center z-50 animate-in slide-in-from-bottom-10">
          <div className="flex items-center gap-3">
            <button onClick={() => { setIsMultiMode(false); setSelectedIds(new Set()); }} className="p-2 bg-white/10 rounded-full active:scale-95 transition"><X className="w-5 h-5"/></button>
            <div className="font-black text-lg">已選 {selectedIds.size} 人</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSelectedIds(new Set(filteredStudents.map(s=>s.id)))} className="px-4 py-3 bg-white/10 rounded-2xl text-sm font-bold active:scale-95 transition">全選</button>
            <button disabled={selectedIds.size === 0} onClick={() => setSelectedStudentsForModal(students.filter(s => selectedIds.has(s.id)))} className="px-5 py-3 bg-indigo-500 rounded-2xl font-black shadow-lg disabled:opacity-50 active:scale-95 transition">給分</button>
          </div>
        </div>
      )}

      {/* 編輯名單模態框 */}
      {isEditingStudents && (
        <EditStudentsModal 
          classId={classData.id}
          students={students}
          onClose={() => setIsEditingStudents(false)}
          onSave={(updatedList) => {
            onUpdateStudents(classData.id, updatedList);
            setIsEditingStudents(false);
          }}
        />
      )}

      {selectedStudentsForModal.length > 0 && (
        <RecordModal 
          selectedStudents={selectedStudentsForModal} classId={classData.id}
          onClose={() => { setSelectedStudentsForModal([]); if (isMultiMode) { setIsMultiMode(false); setSelectedIds(new Set()); } }} 
          onSave={(recs) => { onAddRecords(recs); setSelectedStudentsForModal([]); if (isMultiMode) { setIsMultiMode(false); setSelectedIds(new Set()); } }} 
        />
      )}
    </div>
  );
}

// ==========================================
// 編輯學生名單專用模態框
// ==========================================
function EditStudentsModal({ classId, students, onClose, onSave }) {
  const [localStudents, setLocalStudents] = useState([...students]);
  const [newSeat, setNewSeat] = useState('');
  const [newName, setNewName] = useState('');

  const handleAdd = () => {
    if (!newSeat.trim() || !newName.trim()) return;
    const newStudent = {
      id: `std_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      classId,
      seatNo: newSeat.trim(),
      name: newName.trim()
    };
    setLocalStudents([...localStudents, newStudent]);
    setNewSeat('');
    setNewName('');
  };

  const handleRemove = (id) => {
    setLocalStudents(localStudents.filter(s => s.id !== id));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex flex-col justify-end sm:justify-center items-center z-50 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="px-6 py-5 flex justify-between items-center border-b border-gray-100">
          <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
            <UserCog className="w-5 h-5 text-indigo-600" />
            編輯學生名單
          </h3>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full active:scale-95 transition"><X className="w-5 h-5" /></button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="bg-indigo-50 p-4 rounded-2xl border border-indigo-100">
            <h4 className="text-xs font-bold text-indigo-800 mb-3 flex items-center gap-1">
              <Plus className="w-4 h-4" /> 加入轉入生
            </h4>
            <div className="flex gap-2 items-end">
              <div className="w-20">
                <label className="block text-[10px] font-bold text-indigo-400 mb-1">座號</label>
                <input type="number" value={newSeat} onChange={e=>setNewSeat(e.target.value)} placeholder="00" className="w-full p-2.5 rounded-xl border border-white bg-white outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 text-sm font-bold" />
              </div>
              <div className="flex-1">
                <label className="block text-[10px] font-bold text-indigo-400 mb-1">姓名</label>
                <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="學生姓名" className="w-full p-2.5 rounded-xl border border-white bg-white outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 text-sm font-bold" />
              </div>
              <button onClick={handleAdd} disabled={!newSeat || !newName} className="h-[42px] px-4 bg-indigo-600 text-white rounded-xl font-bold active:scale-95 disabled:opacity-50 transition shadow-sm">
                新增
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center mb-1">
              <h4 className="text-sm font-bold text-gray-500">班級目前名單</h4>
              <span className="text-xs font-bold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{localStudents.length} 人</span>
            </div>
            <div className="max-h-56 overflow-y-auto space-y-2 pr-2">
              {localStudents.sort((a,b)=> (parseInt(a.seatNo)||0) - (parseInt(b.seatNo)||0)).map(s => (
                <div key={s.id} className="flex justify-between items-center bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="bg-gray-100 text-gray-500 font-black text-xs px-2 py-1 rounded-lg">{s.seatNo}</span>
                    <span className="font-bold text-gray-900">{s.name}</span>
                  </div>
                  <button onClick={() => handleRemove(s.id)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition" title="移除此學生">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {localStudents.length === 0 && (
                <div className="text-center py-6 text-gray-400 font-bold text-sm">名單已清空</div>
              )}
            </div>
          </div>
        </div>
        
        <div className="p-4 border-t border-gray-100 bg-gray-50">
          <button onClick={() => onSave(localStudents)} className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-md active:scale-95 transition flex justify-center items-center gap-2">
            <Save className="w-5 h-5" /> 儲存名單變更
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordModal({ selectedStudents, classId, onClose, onSave }) {
  const [type, setType] = useState('positive'); 
  const [selectedItem, setSelectedItem] = useState('');
  const [points, setPoints] = useState(1);
  const [note, setNote] = useState('');
  
  const handleSave = () => {
    if (!selectedItem) return;
    onSave(selectedStudents.map(s => ({
      classId, studentId: s.id, studentName: s.name, studentNo: s.seatNo || s.no,
      date: new Date().toISOString().split('T')[0], type, item: selectedItem, points: type === 'positive' ? Math.abs(points) : -Math.abs(points), note
    })));
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex flex-col justify-end sm:justify-center items-center z-50 sm:p-4">
      <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200">
        <div className="px-6 py-5 flex justify-between items-center border-b border-gray-100">
          <div>
            <h3 className="text-xs font-bold text-gray-400 uppercase">新增紀錄</h3>
            <h4 className="text-lg font-black text-indigo-600">{selectedStudents.length === 1 ? selectedStudents[0].name : `批次 (${selectedStudents.length} 人)`}</h4>
          </div>
          <button onClick={onClose} className="p-2 bg-gray-100 rounded-full active:scale-95"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 pb-8 space-y-6 max-h-[75vh] overflow-y-auto">
          <div className="flex bg-gray-100 p-1.5 rounded-2xl">
            <button onClick={() => { setType('positive'); setPoints(1); setSelectedItem(''); }} className={`flex-1 py-3.5 rounded-xl font-black flex items-center justify-center gap-2 transition ${type === 'positive' ? 'bg-white text-green-600 shadow-sm' : 'text-gray-400'}`}><ThumbsUp className="w-5 h-5"/> 獎勵</button>
            <button onClick={() => { setType('negative'); setPoints(1); setSelectedItem(''); }} className={`flex-1 py-3.5 rounded-xl font-black flex items-center justify-center gap-2 transition ${type === 'negative' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-400'}`}><ThumbsDown className="w-5 h-5"/> 懲處</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES[type].map(item => (
              <button key={item} onClick={() => setSelectedItem(item)} className={`py-3 text-xs font-bold rounded-xl border-2 transition ${selectedItem === item ? (type === 'positive' ? 'bg-green-100 border-green-500 text-green-700' : 'bg-red-100 border-red-500 text-red-700') : 'bg-white border-gray-100 text-gray-600'}`}>{item}</button>
            ))}
          </div>
          <div className="flex items-center justify-between bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <span className="font-black text-gray-900">設定點數</span>
            <div className="flex gap-4">
              <button onClick={() => setPoints(Math.max(1, points-1))} className="w-10 h-10 rounded-full bg-white shadow-sm font-black active:scale-95">-</button>
              <span className="font-black text-2xl w-8 text-center text-indigo-600">{points}</span>
              <button onClick={() => setPoints(points+1)} className="w-10 h-10 rounded-full bg-white shadow-sm font-black active:scale-95">+</button>
            </div>
          </div>

          <div className="mb-2">
            <label className="block text-sm font-bold text-gray-700 mb-2">備註事項 (選填)</label>
            <input 
              type="text" 
              value={note} 
              onChange={(e) => setNote(e.target.value)}
              placeholder="輸入相關備註..." 
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm font-medium"
            />
          </div>

          <button onClick={handleSave} disabled={!selectedItem} className={`w-full py-4 rounded-2xl font-black text-white text-lg shadow-xl transition active:scale-95 ${!selectedItem ? 'bg-gray-300' : (type === 'positive' ? 'bg-green-600' : 'bg-red-500')}`}>確認給分</button>
        </div>
      </div>
    </div>
  );
}