import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, browserLocalPersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyD9uc36V0UXjk74Y0iLSP-5zE0lXzMPFHk',
  authDomain: 'eco-habit-dd966.firebaseapp.com',
  projectId: 'eco-habit-dd966',
  storageBucket: 'eco-habit-dd966.firebasestorage.app',
  messagingSenderId: '130460115718',
  appId: '1:130460115718:web:853420805810a04a2bb487',
  measurementId: 'G-B8V6Q1RYW3',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getApps().length > 1
  ? getAuth(app)
  : initializeAuth(app, { persistence: browserLocalPersistence });

export const db = getFirestore(app);
