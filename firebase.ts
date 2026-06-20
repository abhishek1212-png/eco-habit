import { initializeApp, getApps } from 'firebase/app';
import { getReactNativePersistence, initializeAuth, getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Replace these values with your Firebase project settings.
// Get them from the Firebase Console under Project Settings.
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
  : initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
export const db = getFirestore(app);
