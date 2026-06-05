import { initializeApp, getApp, getApps } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: "AIzaSyCdhWff4X_XHvoIw_mhFDGRjy9vC4ymFc4",
  authDomain: "moviename-26960.firebaseapp.com",
  databaseURL: "https://moviename-26960-default-rtdb.firebaseio.com",
  projectId: "moviename-26960",
  storageBucket: "moviename-26960.firebasestorage.app",
  messagingSenderId: "745803258160",
  appId: "1:745803258160:web:94974f7633fd84a1f3d0f5"
};

// Initialize Firebase
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const db = getDatabase(app);
