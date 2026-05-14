import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
  Plus, Minus, Users, Settings, Save, RefreshCw, Trash2, 
  ChevronRight, ChevronLeft, MoreHorizontal, LogOut, Cloud, 
  CloudOff, CheckCircle2, AlertCircle, User, LogIn, ShieldCheck,
  Check, X, ClipboardList, UserPlus, GraduationCap, UploadCloud,
  FileSpreadsheet, UserCog, FileDown, ThumbsUp, ThumbsDown, Database,
  CheckSquare, Search, Filter, Download, LayoutDashboard, History
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, 
  signOut, signInAnonymously, signInWithCustomToken 
} from 'firebase/auth';
import { 
  getFirestore, doc, setDoc, getDoc, collection, onSnapshot, 
  query, where, deleteDoc, updateDoc, addDoc, writeBatch, serverTimestamp
} from 'firebase/firestore';
import * as XLSX from 'xlsx';

// --- 1. 共用常數與預設資料 (Constants) ---
const CATEGORIES = {
  positive: ['遵守秩序', '課業優良', '值日盡責', '整齊清潔', '服儀端正', '禮節週到', '熱心公務', '其他獎勵'],
  negative: ['秩序欠佳', '欠繳作業', '工作怠惰', '環境髒亂', '缺乏責任感', '言行不當', '遲到', '其他處罰']
};

// --- 2. Firebase 初始化 (修復白畫面：加入本地防護與金鑰) ---
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
  if (user.isAnonymous) return '訪客 (未綁定 Google)';
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
  const [appData, setAppData] = useState({ classes: [], students: [], records: [], settings: { gasUrl: '' } });
  const [syncStatus, setSyncStatus] = useState('idle');
  const [modalOpen, setModalOpen] = useState(null); // 'score', 'importClass', 'editStudents'
  const [multiSelect, setMultiSelect] = useState([]);
  const [isMultiMode, setIsMultiMode] = useState(false);
  const [notification, setNotification] = useState(null);

  // --- 認證與監聽 ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
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

  // --- 動作處理 ---
  const handleGuestLogin = async () => {
    setAuthLoading(true);
    try { await signInAnonymously(auth); } catch (e) {
      console.warn("Guest login failed", e);
      setUser({ uid: 'local-guest', isAnonymous: true, displayName: '訪客' });
      setAuthLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); } catch (e) { console.error(e); }
  };

  const handleAddClass = async (classData, students) => {
    if (!user) return;
    try {
      const newClassRef = await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'classes'), {
        name: classData.name, createdAt: Date.now()
      });
      if (students && students.length > 0) {
        const batch = writeBatch(db);
        students.forEach(s => {
          const stuRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'students'));
          batch.set(stuRef, { classId: newClassRef.id, name: s.name, seatNo: s.seatNo, totalScore: 0, createdAt: Date.now() });
        });
        await batch.commit();
      }
      setModalOpen(null);
      showNotify("班級建立成功！");
    } catch (error) {
      console.error("建立班級失敗", error);
      showNotify("建立班級失敗，請檢查網路連線");
      setModalOpen(null);
    }
  };

  const handleDeleteClass = async (id) => {
    if (!user || !window.confirm("確定刪除班級？此動作無法復原。")) return;
    await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'classes', id));
    if (selectedClassId === id) setSelectedClassId(null);
    showNotify("班級已刪除");
  };

  const handleScore = async (studentIds, type, amount, note = "") => {
    if (!user) return;
    const batch = writeBatch(db);
    const timestamp = Date.now();
    studentIds.forEach(sid => {
      const student = appData.students.find(s => s.id === sid);
      const newRef = doc(collection(db, 'artifacts', appId, 'users', user.uid, 'records'));
      batch.set(newRef, {
        studentId: sid, studentName: student?.name || '未知', classId: student?.classId,
        type, score: type === 'positive' ? amount : -amount, note, timestamp
      });
    });
    await batch.commit();
    setModalOpen(null);
    if (isMultiMode) { setMultiSelect([]); setIsMultiMode(false); }
    showNotify(studentIds.length > 1 ? `已批次新增 ${studentIds.length} 筆紀錄` : "已新增紀錄");
  };

  const handleExport = () => {
    const csvContent = "\uFEFF" + "日期,學生,班級,類型,分數,備註\n" +
      appData.records.filter(r => r.classId === selectedClassId).map(r => {
        const date = new Date(r.timestamp).toLocaleDateString();
        const cls = appData.classes.find(c => c.id === r.classId)?.name || '未知';
        return `${date},${r.studentName},${cls},${r.type === 'positive' ? '獎勵' : '懲處'},${r.score},${r.note}`;
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
        totalPoints: sRecs.reduce((sum, r) => sum + r.score, 0),
        positivePoints: sRecs.filter(r => r.type === 'positive').reduce((sum, r) => sum + r.score, 0),
        negativePoints: sRecs.filter(r => r.type === 'negative').reduce((sum, r) => sum + r.score, 0)
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
        <button onClick={() => signOut(auth)} className="hidden lg:flex mt-auto p-4 text-slate-400 hover:text-red-500 transition-colors">
          <LogOut size={24} />
        </button>
      </nav>

      <main className="max-w-6xl mx-auto p-6 md:p-10">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">
              {activeTab === 'classes' ? '班級管理' : activeTab === 'behavior' ? '行為計分紀錄' : '系統備份與設定'}
            </h1>
            <p className="text-slate-500 font-medium mt-1">{user.isAnonymous ? '訪客模式 (本機暫存)' : `歡迎回來，${getUserDisplayName(user)}`}</p>
          </div>
          <div className="flex items-center gap-3 bg-white p-2 rounded-2xl border border-slate-100 shadow-sm">
            <div className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 ${syncStatus === 'success' ? 'bg-green-50 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
              <div className={`w-2 h-2 rounded-full ${syncStatus === 'success' ? 'bg-green-500' : 'bg-blue-500 animate-pulse'}`} /> 雲端連線中
            </div>
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
                      <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center font-black text-2xl">{cls.name.charAt(0)}</div>
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
              <div className="flex gap-2 overflow-x-auto w-full md:w-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
                {appData.classes.map(c => (
                  <button 
                    key={c.id} onClick={() => { setSelectedClassId(c.id); setIsMultiMode(false); setMultiSelect([]); }}
                    className={`px-6 py-3 rounded-2xl font-bold text-sm whitespace-nowrap transition-all border-2 ${selectedClassId === c.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-500'}`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 w-full md:w-auto">
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
                   <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 lg:gap-4">
                     {activeClassData.students.map(stu => (
                       <div 
                         key={stu.id}
                         onClick={() => isMultiMode ? setMultiSelect(prev => prev.includes(stu.id) ? prev.filter(id=>id!==stu.id) : [...prev, stu.id]) : null}
                         className={`relative p-4 rounded-3xl border-2 transition-all flex flex-col justify-between aspect-square ${multiSelect.includes(stu.id) ? 'border-indigo-600 bg-indigo-50' : 'border-slate-100 bg-white shadow-sm hover:border-indigo-200'}`}
                       >
                         <div className="flex justify-between items-start w-full">
                           <span className={`text-xs font-black px-2 py-1 rounded-lg ${multiSelect.includes(stu.id) ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-100 text-slate-500'}`}>{stu.seatNo || '-'}</span>
                           {isMultiMode && <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 ${multiSelect.includes(stu.id) ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200'}`}>{multiSelect.includes(stu.id) && <Check size={14} />}</div>}
                         </div>
                         <div className="text-center w-full">
                           <span className={`text-3xl font-black ${stu.totalPoints >= 0 ? 'text-green-500' : 'text-red-500'}`}>{stu.totalPoints}</span>
                         </div>
                         <div className="font-black text-slate-800 text-center truncate w-full text-lg mb-1">{stu.name}</div>
                         
                         {!isMultiMode && (
                           <div className="absolute inset-0 opacity-0 hover:opacity-100 bg-white/95 rounded-3xl flex flex-col items-center justify-center gap-3 transition-opacity">
                              <div className="flex gap-3">
                                <button onClick={(e) => { e.stopPropagation(); setMultiSelect([stu.id]); setModalOpen('score'); }} className="p-3 bg-green-500 text-white rounded-2xl hover:bg-green-600"><ThumbsUp size={20}/></button>
                                <button onClick={(e) => { e.stopPropagation(); setMultiSelect([stu.id]); setModalOpen('score'); }} className="p-3 bg-red-500 text-white rounded-2xl hover:bg-red-600"><ThumbsDown size={20}/></button>
                              </div>
                              <span className="text-[10px] font-bold text-slate-400">點擊開啟評分</span>
                           </div>
                         )}
                       </div>
                     ))}
                   </div>

                   {/* 多選操作列 */}
                   {isMultiMode && multiSelect.length > 0 && (
                     <div className="fixed bottom-24 lg:bottom-10 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-6 py-4 rounded-full flex items-center gap-6 shadow-2xl z-50 animate-in slide-in-from-bottom-10">
                        <span className="text-sm font-black whitespace-nowrap">已選 {multiSelect.length} 人</span>
                        <div className="flex gap-2">
                          <button onClick={() => setMultiSelect(activeClassData.students.map(s => s.id))} className="bg-white/20 px-4 py-2 rounded-full font-bold text-sm">全選</button>
                          <button onClick={() => setModalOpen('score')} className="bg-indigo-500 px-6 py-2 rounded-full font-black text-sm">評分</button>
                        </div>
                     </div>
                   )}
                </div>

                <div className="bg-white rounded-[2.5rem] border border-slate-100 p-6 shadow-sm h-fit">
                   <div className="flex items-center justify-between mb-6">
                     <h3 className="font-black text-lg flex items-center gap-2"><History size={20} className="text-indigo-600" /> 最近活動</h3>
                   </div>
                   <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                     {appData.records.filter(r => r.classId === selectedClassId).slice(0, 15).map(rec => (
                       <div key={rec.id} className="flex gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                         <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${rec.type === 'positive' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                           {rec.type === 'positive' ? <ThumbsUp size={16} /> : <ThumbsDown size={16} />}
                         </div>
                         <div className="flex-1 min-w-0">
                           <div className="flex justify-between items-center">
                             <p className="font-bold text-sm text-slate-800 truncate">{rec.studentName}</p>
                             <span className="text-[10px] font-bold text-slate-400">{new Date(rec.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                           </div>
                           <p className="text-xs text-slate-500 font-medium truncate">{rec.note || rec.item} ({rec.score > 0 ? '+' : ''}{rec.score})</p>
                         </div>
                       </div>
                     ))}
                   </div>
                </div>
              </div>
            ) : (
              <EmptyState title="請選擇班級" subtitle="從上方列表切換班級以開始計分" icon={<LayoutDashboard size={48}/>} />
            )}
          </div>
        )}

        {/* ---------------- 系統設定 ---------------- */}
        {activeTab === 'settings' && (
          <div className="max-w-2xl space-y-6">
            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
              <h3 className="font-black text-xl mb-6 flex items-center gap-2"><Database size={24} className="text-green-600"/> GAS 雲端備份設定</h3>
              <p className="text-sm text-slate-500 mb-4 font-medium">您可以將資料備份到 Google Sheets 試算表，請貼上您的 Apps Script 網址：</p>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={appData.settings.gasUrl || ''} 
                  onChange={(e) => setAppData({...appData, settings: { ...appData.settings, gasUrl: e.target.value }})}
                  className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 font-medium text-sm focus:border-green-500 outline-none"
                  placeholder="https://script.google.com/macros/s/..."
                />
                <button 
                  onClick={async () => {
                    if (user) await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), appData.settings);
                    showNotify("網址已儲存");
                  }}
                  className="px-6 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700"
                >儲存</button>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] border border-slate-100 p-8 shadow-sm">
               <h3 className="font-black text-xl mb-6 text-slate-800">帳號管理</h3>
               <button onClick={() => signOut(auth)} className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-bold hover:bg-red-100 flex items-center justify-center gap-2">
                 <LogOut size={20} /> 登出系統
               </button>
            </div>
          </div>
        )}
      </main>

      {/* ---------------- Modals ---------------- */}
      
      <Modal isOpen={modalOpen === 'importClass'} onClose={() => setModalOpen(null)} title="新增班級">
        <ImportClassModal 
          onSave={handleAddClass}
          showNotify={showNotify}
        />
      </Modal>

      <Modal isOpen={modalOpen === 'editStudents'} onClose={() => setModalOpen(null)} title="編輯學生名單">
        <EditStudentsModal 
          classId={selectedClassId}
          students={appData.students.filter(s => s.classId === selectedClassId)}
          user={user} db={db} appId={appId}
        />
      </Modal>

      <Modal isOpen={modalOpen === 'score'} onClose={() => setModalOpen(null)} title={multiSelect.length === 1 ? appData.students.find(s=>s.id===multiSelect[0])?.name : `批次給分 (${multiSelect.length}人)`}>
        <ScoreModal 
          onSave={(type, item, pts, note) => handleScore(multiSelect, type, pts, note)}
        />
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
    if (!className.trim() || !selectedFile) {
        if (!selectedFile && className.trim()) {
            onSave({ name: className }, []);
        } else {
            showNotify("請輸入班級名稱");
        }
        return;
    }
    setIsImporting(true);
    showNotify("正在智慧掃描名單...");

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const workbook = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
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
            throw new Error("找不到包含「座號」與「姓名」的標題欄。");
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

          onSave({ name: className }, students);
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
        <input 
          autoFocus 
          value={className} 
          onChange={e => setClassName(e.target.value)} 
          placeholder="例如：101班" 
          className="w-full bg-slate-50 border-2 border-slate-100 focus:border-indigo-500 rounded-2xl p-4 outline-none font-bold transition-all" 
        />
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

function EditStudentsModal({ classId, students, user, db, appId }) {
  const [newSeat, setNewSeat] = useState('');
  const [newName, setNewName] = useState('');

  const addStudent = async () => {
    if (!newSeat || !newName || !user) return;
    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'students'), {
      classId, seatNo: newSeat, name: newName, totalScore: 0, createdAt: Date.now()
    });
    setNewSeat(''); setNewName('');
  };

  const deleteStudent = async (id) => {
    if (window.confirm("確定移除該名學生？")) {
      await deleteDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'students', id));
    }
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
            <button onClick={() => deleteStudent(s.id)} className="text-slate-300 hover:text-red-500 p-1.5 transition-colors"><Trash2 size={16}/></button>
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