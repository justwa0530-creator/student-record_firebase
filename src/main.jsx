import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css' // 如果您的專案沒有這支檔案，這行可以刪掉

// 注意：已經把 getElementById('root') 後面的驚嘆號 ! 拔掉了
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)