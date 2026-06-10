import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getReactNativePersistence } from 'firebase/auth/react-native';
import { getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';
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

// On React Native, Firebase needs AsyncStorage to persist login sessions.
// Without this, the user gets logged out every time the app restarts.
let auth;
try {
  if (Platform.OS !== 'web') {
    auth = initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } else {
    auth = getAuth(app);
  }
} catch {
  // Auth already initialized (e.g. hot reload) — just grab the existing instance
  auth = getAuth(app);
}

export { auth };
export const db = getFirestore(app);
