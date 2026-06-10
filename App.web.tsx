/**
 * App.web.tsx — AWS / Web version of Eco Habit
 * Expo automatically uses this file for web builds instead of App.tsx.
 *
 * Differences from App.tsx (mobile/Apple):
 *  - No expo-notifications (not supported on web)
 *  - No react-native-confetti-cannon (not supported on web)
 *  - No KeyboardAvoidingView (not needed on web)
 *  - Responsive desktop layout (max-width centred column)
 *  - Firebase Auth + Firestore still used (work fine on web)
 *  - AsyncStorage still used (falls back to localStorage on web)
 */

import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Animated,
  Easing,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { auth, db } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth';
// eco_usernames/{username} → { uid, email }  (reverse-lookup for login)
import { doc, getDoc, setDoc, collection, getDocs, query, where } from 'firebase/firestore';

// ─── Types ────────────────────────────────────────────────────────────────────
type Habit = {
  id: string; title: string; time: string; completed: boolean;
  streak: number; lastCompletedDate: string | null;
};
type LoginState = { email: string; password: string };
type Credentials = { email: string; password?: string };

const XP_PER = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Carbon footprint savings per deed (grams CO₂ saved, based on EPA/IPCC data) ──
const CO2_SAVINGS_G: Record<string, number> = {
  'public-transport': 2600,
  'walk':             2600,
  'stairs':           50,
  'zoom':             5000,
  'reuse':            33,
  'reusable-cup':     80,
  'recycled-plastic': 200,
  'bottle':           80,
  'plants':           10,
  'recycle':          300,
  'segregate':        150,
  'switch-off':       200,
  'lower-hvac':       500,
  'solar':            1500,
  'full-appliances':  300,
  'repair':           500,
  'plant-diet':       1500,
  'eco-shopping':     200,
  'compost':          300,
  'sustainable':      500,
};

function calcCarbonKg(completedHabits: { title: string }[], allDeeds: { id: string; label: string }[]): number {
  return completedHabits.reduce((sum, h) => {
    const deed = allDeeds.find(d => d.label === h.title);
    if (!deed) return sum;
    return sum + (CO2_SAVINGS_G[deed.id] ?? 300);
  }, 0) / 1000;
}

// ─── Category colours ─────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, { bg: string; activeBg: string; border: string; pill: string; text: string }> = {
  transport:     { bg: '#e0f2fe', activeBg: '#bae6fd', border: '#38bdf8', pill: '#0369a1', text: '#0369a1' },
  plastic:       { bg: '#f3e8ff', activeBg: '#e9d5ff', border: '#c084fc', pill: '#6b21a8', text: '#6b21a8' },
  'water-waste': { bg: '#e0f7fa', activeBg: '#b2ebf2', border: '#22d3ee', pill: '#0e7490', text: '#0e7490' },
  energy:        { bg: '#fef9c3', activeBg: '#fde68a', border: '#facc15', pill: '#854d0e', text: '#854d0e' },
  consumption:   { bg: '#fff7ed', activeBg: '#fed7aa', border: '#fb923c', pill: '#9a3412', text: '#9a3412' },
  general:       { bg: '#f0fdf4', activeBg: '#bbf7d0', border: '#4ade80', pill: '#166534', text: '#166534' },
};

// ─── Deed categories ──────────────────────────────────────────────────────────
const DEFAULT_DEED_CATEGORIES = [
  { id: 'transport',   name: 'Transport',         deeds: [
    { id: 'public-transport', label: 'Took public transport', emoji: '🚌' },
    { id: 'walk',             label: 'Walk or Bike',           emoji: '🚴' },
    { id: 'stairs',           label: 'Took Stairs',            emoji: '🚶' },
    { id: 'zoom',             label: 'Zoom not travel',        emoji: '💻' },
  ]},
  { id: 'plastic',     name: 'Say No to Plastic', deeds: [
    { id: 'reuse',           label: 'Use Reusable Bag',    emoji: '🛍️' },
    { id: 'reusable-cup',    label: 'Reusable bottle/cup', emoji: '🥤' },
    { id: 'recycled-plastic',label: 'Recycled plastic',    emoji: '♻️' },
  ]},
  { id: 'water-waste', name: 'Water & Waste',     deeds: [
    { id: 'bottle',   label: 'Refill Water Bottle', emoji: '💧' },
    { id: 'plants',   label: 'Water Plants',         emoji: '🌿' },
    { id: 'recycle',  label: 'Recycle Waste',        emoji: '♻️' },
    { id: 'segregate',label: 'Segregated Waste',     emoji: '🗑️' },
  ]},
  { id: 'energy',      name: 'Energy',            deeds: [
    { id: 'switch-off', label: 'Switch Off Lights/Fan', emoji: '💡' },
    { id: 'lower-hvac', label: 'Lower Heating/Cooling', emoji: '🌡️' },
    { id: 'solar',      label: 'Installed Solar Panel',  emoji: '🔆' },
  ]},
  { id: 'consumption', name: 'Consumption',       deeds: [
    { id: 'full-appliances', label: 'Full appliance load', emoji: '🧺' },
    { id: 'repair',          label: 'Repair not replace',  emoji: '🛠️' },
    { id: 'plant-diet',      label: 'Plant based diet',    emoji: '🥗' },
    { id: 'eco-shopping',    label: 'Buy eco friendly',    emoji: '🛒' },
    { id: 'compost',         label: 'Compost peelings',    emoji: '🍂' },
  ]},
  { id: 'general',     name: 'General',           deeds: [
    { id: 'sustainable', label: 'Do Sustainable Eco Deeds', emoji: '🌎' },
  ]},
];

// ─── Streak Tree (web-safe, no native animations) ─────────────────────────────
type TreeConfig = { tiers: number; canopyW: number; canopyH: number; trunkH: number; trunkW: number; color: string; label: string };
const TREE_CONFIGS: (TreeConfig | null)[] = [
  null,
  { tiers: 1, canopyW: 44,  canopyH: 30,  trunkH: 14, trunkW: 8,  color: '#86efac', label: 'Seedling'   },
  { tiers: 1, canopyW: 72,  canopyH: 50,  trunkH: 22, trunkW: 12, color: '#4ade80', label: 'Sapling'    },
  { tiers: 2, canopyW: 104, canopyH: 66,  trunkH: 34, trunkW: 16, color: '#22c55e', label: 'Young Tree'  },
  { tiers: 2, canopyW: 136, canopyH: 84,  trunkH: 46, trunkW: 20, color: '#16a34a', label: 'Mature Tree' },
  { tiers: 3, canopyW: 164, canopyH: 102, trunkH: 58, trunkW: 22, color: '#15803d', label: 'Great Tree'  },
  { tiers: 3, canopyW: 196, canopyH: 122, trunkH: 70, trunkW: 26, color: '#14532d', label: '🌟 Mighty Oak' },
];

function StreakTree({ streak, broken }: { streak: number; broken: boolean }) {
  const level = broken || streak === 0 ? 0 : streak <= 2 ? 1 : streak <= 6 ? 2 : streak <= 13 ? 3 : streak <= 20 ? 4 : streak <= 29 ? 5 : 6;
  if (level === 0) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 14 }}>
        <Text style={{ fontSize: 40 }}>🪓</Text>
        <View style={{ width: 40, height: 22, backgroundColor: '#92400e', borderRadius: 4, marginTop: 6 }} />
        <Text style={{ color: '#ef4444', fontWeight: '800', marginTop: 10, fontSize: 14, textAlign: 'center' }}>
          {broken ? 'Streak broken! Start fresh 🌱' : 'Complete a habit to grow your tree!'}
        </Text>
      </View>
    );
  }
  const cfg = TREE_CONFIGS[level]!;
  return (
    <View style={{ alignItems: 'center', paddingVertical: 14 }}>
      <View style={{ alignItems: 'center' }}>
        {cfg.tiers >= 3 && <View style={{ width: cfg.canopyW * 0.52, height: cfg.canopyH * 0.52, backgroundColor: cfg.color, borderRadius: cfg.canopyW, marginBottom: -(cfg.canopyH * 0.14), opacity: 0.85 }} />}
        {cfg.tiers >= 2 && <View style={{ width: cfg.canopyW * 0.78, height: cfg.canopyH * 0.74, backgroundColor: cfg.color, borderRadius: cfg.canopyW, marginBottom: -(cfg.canopyH * 0.16), opacity: 0.92 }} />}
        <View style={{ width: cfg.canopyW, height: cfg.canopyH, backgroundColor: cfg.color, borderRadius: cfg.canopyW / 1.4 }} />
      </View>
      <View style={{ width: cfg.trunkW, height: cfg.trunkH, backgroundColor: '#92400e', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
      <Text style={{ color: '#0b8457', fontWeight: '800', marginTop: 10, fontSize: 14 }}>{cfg.label} · 🔥 {streak} day{streak !== 1 ? 's' : ''}</Text>
    </View>
  );
}

// ─── Web Confetti ─────────────────────────────────────────────────────────────
function fireWebConfetti() {
  try {
    const win = window as any;
    const fire = () => win.confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#4ade80','#22c55e','#facc15','#fb923c','#60a5fa','#f472b6','#a78bfa'],
    });
    if (win.confetti) { fire(); return; }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
    script.onload = fire;
    document.head.appendChild(script);
  } catch {}
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [deedCategories] = useState(DEFAULT_DEED_CATEGORIES);
  const [customDeeds, setCustomDeeds] = useState<Array<{id:string;label:string;emoji:string}>>([]);
  const deeds = [...DEFAULT_DEED_CATEGORIES.flatMap(c => c.deeds), ...customDeeds];
  const [newDeedLabel, setNewDeedLabel] = useState('');
  const [newDeedEmoji, setNewDeedEmoji] = useState('');

  const [time, setTime] = useState('08:00');
  const [ampm, setAmpm] = useState<'AM' | 'PM'>('AM');
  const [selectedDeed, setSelectedDeed] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [habits, setHabits] = useState<Habit[]>([]);
  const [xp, setXp] = useState(0);

  const [loggedIn, setLoggedIn] = useState(false);
  const [login, setLogin] = useState<LoginState>({ email: '', password: '' });
  const [signupUsername, setSignupUsername] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [username, setUsername] = useState('');
  const [needsUsername, setNeedsUsername] = useState(false);
  const [pendingUsername, setPendingUsername] = useState('');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<'home'|'leaderboard'>('home');
  const [leaderboard, setLeaderboard] = useState<{rank:number;username:string;xp:number;streak:number;level:number}[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const lbLastFetch = useRef<number>(0);

  const [globalStreak, setGlobalStreak] = useState(0);
  const [lastActivityDate, setLastActivityDate] = useState<string | null>(null);
  const [streakBroken, setStreakBroken] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  // Login animation
  const earthY     = useRef(new Animated.Value(160)).current;
  const earthScale = useRef(new Animated.Value(0.3)).current;
  const earthBob   = useRef(new Animated.Value(0)).current;
  const loginFade  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!loggedIn) {
      earthY.setValue(160); earthScale.setValue(0.3); earthBob.setValue(0); loginFade.setValue(0);
      Animated.sequence([
        Animated.parallel([
          Animated.spring(earthY,     { toValue: 0, tension: 55, friction: 7, useNativeDriver: true }),
          Animated.spring(earthScale, { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
        ]),
        Animated.timing(loginFade, { toValue: 1, duration: 450, useNativeDriver: true }),
      ]).start(() => {
        Animated.loop(Animated.sequence([
          Animated.timing(earthBob, { toValue: -12, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(earthBob, { toValue: 0,   duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])).start();
      });
    }
  }, [loggedIn]);

  // Load from storage
  useEffect(() => {
    (async () => {
      try {
        const [habitsStr, xpStr, storedCreds, streakStr, lastDateStr, customDeedsStr, storedUsername] = await Promise.all([
          AsyncStorage.getItem('eco_habits'),
          AsyncStorage.getItem('eco_xp'),
          AsyncStorage.getItem('eco_user_credentials'),
          AsyncStorage.getItem('eco_global_streak'),
          AsyncStorage.getItem('eco_last_activity_date'),
          AsyncStorage.getItem('eco_custom_deeds'),
          AsyncStorage.getItem('eco_username'),
        ]);
        if (habitsStr) setHabits(JSON.parse(habitsStr));
        if (xpStr) setXp(parseInt(xpStr, 10));
        if (customDeedsStr) { try { setCustomDeeds(JSON.parse(customDeedsStr)); } catch {} }
        if (storedUsername) setUsername(storedUsername);
        if (storedCreds) {
          try {
            const c = JSON.parse(storedCreds) as Credentials;
            setLogin({ email: c.email, password: '' });
          } catch {}
        }
        const savedStreak = streakStr ? parseInt(streakStr, 10) : 0;
        const savedLastDate = lastDateStr ?? null;
        setLastActivityDate(savedLastDate);
        if (savedStreak > 0 && savedLastDate && savedLastDate < yesterdayStr()) {
          setGlobalStreak(0); setStreakBroken(true);
        } else {
          setGlobalStreak(savedStreak);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([
          AsyncStorage.setItem('eco_habits', JSON.stringify(habits)),
          AsyncStorage.setItem('eco_xp', String(xp)),
          AsyncStorage.setItem('eco_global_streak', String(globalStreak)),
          AsyncStorage.setItem('eco_last_activity_date', lastActivityDate ?? ''),
          AsyncStorage.setItem('eco_custom_deeds', JSON.stringify(customDeeds)),
        ]);
      } catch {}
    })();
  }, [habits, xp, globalStreak, lastActivityDate, customDeeds]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setFirebaseUser(user); setLoggedIn(true);
        // Load from Firestore first (most reliable source)
        const snap = await getDoc(doc(db,'eco_users',user.uid));
        if (snap.exists()) {
          const data = snap.data() as any;
          if (data.username) {
            setUsername(data.username);
            await AsyncStorage.setItem('eco_username', data.username);
          } else {
            // Existing account with no username — prompt once
            const storedUname = await AsyncStorage.getItem('eco_username');
            if (storedUname) setUsername(storedUname);
            else setNeedsUsername(true);
          }
        }
        await loadRemoteUserData(user.uid);
      } else {
        setFirebaseUser(null); setLoggedIn(false);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    saveRemoteUserData(firebaseUser.uid);
  }, [habits, xp, globalStreak, lastActivityDate, customDeeds, firebaseUser]);

  // Helpers
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const yesterdayStr = () => {
    const d = new Date(); d.setDate(d.getDate()-1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  const parseTimeToNextDate = (timeWithAmpm: string, dateStr?: string) => {
    const m = timeWithAmpm.trim().match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])/);
    if (!m) return null;
    let hh = parseInt(m[1],10); const mm = parseInt(m[2],10); const ap = m[3].toUpperCase();
    if (ap==='AM') { if (hh===12) hh=0; } else { if (hh!==12) hh+=12; }
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y,mo,d] = dateStr.split('-').map(x=>parseInt(x,10));
      return new Date(y,mo-1,d,hh,mm,0);
    }
    const nowDate = new Date();
    const target = new Date(nowDate.getFullYear(),nowDate.getMonth(),nowDate.getDate(),hh,mm,0);
    if (target.getTime()<=nowDate.getTime()) target.setDate(target.getDate()+1);
    return target;
  };

  const computeNextDateString = (timeOnly: string) => {
    const next = parseTimeToNextDate(timeOnly);
    if (!next) return '';
    return `${String(next.getMonth()+1).padStart(2,'0')}-${String(next.getDate()).padStart(2,'0')}`;
  };

  // Firebase
  const loadRemoteUserData = async (uid: string) => {
    try {
      const snap = await getDoc(doc(db,'eco_users',uid));
      if (snap.exists()) {
        const r = snap.data() as any;
        if (r.habits) setHabits(r.habits);
        if (typeof r.xp==='number') setXp(r.xp);
        if (typeof r.globalStreak==='number') setGlobalStreak(r.globalStreak);
        if (r.lastActivityDate) setLastActivityDate(r.lastActivityDate);
        if (r.customDeeds) setCustomDeeds(r.customDeeds);
        if (r.username) setUsername(r.username);
      } else {
        await setDoc(doc(db,'eco_users',uid), { habits, xp, globalStreak, lastActivityDate });
      }
    } catch {}
  };
  const saveRemoteUserData = async (uid: string) => {
    try { await setDoc(doc(db,'eco_users',uid), { habits, xp, globalStreak, lastActivityDate, customDeeds, username }, { merge:true }); } catch {}
  };

  const fetchLeaderboard = async (force = false) => {
    const now = Date.now();
    if (!force && leaderboard.length > 0 && now - lbLastFetch.current < 60_000) return; // use cache
    setLbLoading(true);
    try {
      const snap = await getDocs(collection(db,'eco_users'));
      const seen = new Set<string>();
      const users = snap.docs
        .map(d => {
          const data = d.data() as any;
          const totalXp = data.xp || 0;
          let lvl=1, acc=0;
          while (true) { const n=100+(lvl-1)*20; if (totalXp<acc+n) break; acc+=n; lvl++; }
          return { username: data.username || '', xp: totalXp, streak: data.globalStreak||0, level: lvl };
        })
        .filter(u => {
          if (!u.username) return false;
          if (seen.has(u.username)) return false;
          seen.add(u.username);
          return true;
        })
        .sort((a,b)=>b.xp-a.xp)
        .slice(0,50)
        .map((u,i)=>({...u, rank:i+1}));
      setLeaderboard(users);
      lbLastFetch.current = Date.now();
    } catch {}
    setLbLoading(false);
  };

  // XP system
  const getLevelInfo = (totalXp: number) => {
    let level=1, xpAccumulated=0;
    while (true) {
      const needed = 100+(level-1)*20;
      if (totalXp < xpAccumulated+needed) break;
      xpAccumulated += needed; level++;
    }
    const required = 100+(level-1)*20;
    const progress = totalXp-xpAccumulated;
    return { level, progress, required, percentage: Math.round((progress/required)*100) };
  };
  const LEVEL_COLORS = ['#22c55e','#14b8a6','#3b82f6','#6366f1','#a855f7','#ec4899','#f97316','#eab308','#ef4444','#f59e0b'];
  const { level, progress, required, percentage } = getLevelInfo(xp);
  const levelColor = LEVEL_COLORS[(level-1) % LEVEL_COLORS.length];

  // Derived
  const upcoming = useMemo(()=>habits.filter(h=>!h.completed),[habits]);
  const categoryProgress = useMemo(()=>deedCategories.map(cat=>{
    const titles = cat.deeds.map(d=>d.label);
    const catHabits = habits.filter(h=>titles.includes(h.title));
    const completed = catHabits.filter(h=>h.completed).length;
    return { ...cat, completed, total:catHabits.length, emoji:cat.deeds[0]?.emoji??'🌿' };
  }),[habits,deedCategories]);
  const treeCompletion = useMemo(()=>{
    if (!categoryProgress.length) return 0;
    return categoryProgress.reduce((s,c)=>s+(c.total?c.completed/c.total:0),0)/categoryProgress.length;
  },[categoryProgress]);
  const treeStages = ['Seedling','Growing Sapling','Branching Out','Leafy Grove','Eco Oak'];
  const treeStage = treeStages[Math.min(treeStages.length-1,Math.floor(treeCompletion*treeStages.length))];

  // Handlers
  const add = () => {
    if (!selectedDeed) { alert('Please choose a deed'); return; }
    const whenOnly = `${time||'08:00'} ${ampm}`;
    const deedLabel = deeds.find(d=>d.id===selectedDeed)?.label ?? selectedDeed;
    const displayTime = date && /^\d{2}-\d{2}$/.test(date) ? `${date} ${whenOnly}` : whenOnly;
    const h: Habit = { id:`${Date.now()}-${selectedDeed}`, title:deedLabel.trim(), time:displayTime, completed:false, streak:0, lastCompletedDate:null };
    setHabits(s=>[h,...s]);
    setTime('08:00'); setAmpm('AM'); setDate(''); setSelectedDeed(null);
  };

  const toggle = (id: string) => {
    const h = habits.find(x=>x.id===id); if (!h) return;
    const willComplete = !h.completed;
    if (willComplete) {
      fireWebConfetti();
      setXp(v=>Math.max(0,v+XP_PER));
      const today = todayStr(); const yest = yesterdayStr();
      const newStreak = h.lastCompletedDate===yest||h.lastCompletedDate===today ? (h.streak||0)+1 : 1;
      setHabits(prev=>prev.map(hh=>hh.id===id?{...hh,completed:true,streak:newStreak,lastCompletedDate:today}:hh));
      if (lastActivityDate!==today) {
        const newGlobal = lastActivityDate===yest ? globalStreak+1 : 1;
        const newXp = xp + XP_PER;
        setGlobalStreak(newGlobal);
        setLastActivityDate(today); setStreakBroken(false);
        // Save immediately so leaderboard is always up to date
        if (firebaseUser) {
          setDoc(doc(db,'eco_users',firebaseUser.uid), { globalStreak: newGlobal, lastActivityDate: today, xp: newXp, username }, { merge: true }).catch(()=>{});
        }
      }
    } else {
      setXp(v=>Math.max(0,v-XP_PER));
      setHabits(prev=>prev.map(hh=>hh.id===id?{...hh,completed:false,streak:Math.max(0,(hh.streak||1)-1)}:hh));
    }
  };
  const remove = (id: string) => setHabits(s=>s.filter(h=>h.id!==id));
  const clearCompleted = () => setHabits(s=>s.filter(h=>!h.completed));

  const handleLogin = async () => {
    const email    = login.email.trim().toLowerCase();
    const password = login.password;
    if (!email || !password) { alert('Enter your email and password'); return; }
    if (!EMAIL_PATTERN.test(email)) { alert('Enter a valid email address'); return; }

    if (isSignup) {
      const uname = signupUsername.trim().toLowerCase();
      if (!uname) { alert('Pick a username'); return; }
      if (!/^[a-z0-9_]{3,20}$/.test(uname)) { alert('Username: 3–20 chars, letters/numbers/underscore only'); return; }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid  = cred.user.uid;
        await AsyncStorage.setItem('eco_user_credentials', JSON.stringify({ email }));
        await AsyncStorage.setItem('eco_username', uname);
        // Save username to Firestore immediately on signup
        await setDoc(doc(db,'eco_users',uid), { username: uname, habits: [], xp: 0, globalStreak: 0, lastActivityDate: null }, { merge: true });
        setUsername(uname); setLogin({ email, password: '' }); setLoggedIn(true); setFirebaseUser(cred.user);
        await loadRemoteUserData(uid);
      } catch (e: any) {
        if (e.code === 'auth/email-already-in-use') alert('That email already has an account. Try logging in.');
        else alert('Could not create account. Please try again.');
      }
    } else {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await AsyncStorage.setItem('eco_user_credentials', JSON.stringify({ email }));
        setLogin({ email, password: '' }); setLoggedIn(true); setFirebaseUser(cred.user);
        await loadRemoteUserData(cred.user.uid);
      } catch (e: any) {
        if (e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') alert('Wrong password. Try again.');
        else if (e.code === 'auth/user-not-found') alert('No account with that email. Sign up instead?');
        else alert('Could not sign in. Check your connection.');
      }
    }
  };

  const handleForgotPassword = async () => {
    const email = forgotEmail.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) { alert('Enter your email address'); return; }
    try {
      await sendPasswordResetEmail(auth, email);
      setForgotSent(true);
    } catch (e: any) {
      if (e.code === 'auth/user-not-found') alert('No account found with that email.');
      else alert('Could not send reset email. Check your email address.');
    }
  };

  const resetRecovery = () => { setForgotMode(false); setForgotEmail(''); setForgotSent(false); };

  const handleLogout = async () => {
    try { await signOut(auth); } catch {}
    AsyncStorage.removeItem('eco_user_credentials').catch(()=>{});
    AsyncStorage.removeItem('eco_username').catch(()=>{});
    setLogin({ email: '', password: '' }); setUsername(''); setLoggedIn(false); setFirebaseUser(null);
    setIsSignup(false); setActiveTab('home');
  };

  // ── Login Screen ──────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <SafeAreaView style={{flex:1,backgroundColor:'#0d3b2e',minHeight:'100vh' as any}}>
        <LinearGradient colors={['#0d3b2e','#1a5c42','#0d3b2e']} style={{flex:1,minHeight:'100vh' as any}} start={[0,0]} end={[1,1]}>
          <StatusBar style="light"/>
          <View style={{flex:1,minHeight:'100vh' as any,alignItems:'center',justifyContent:'center',padding:28,gap:32}}>
            {/* Animated Earth */}
            <Animated.View style={{alignItems:'center',transform:[{translateY:Animated.add(earthY,earthBob)},{scale:earthScale}]}}>
              <View style={{width:120,height:120,borderRadius:60,backgroundColor:'#1565c0',overflow:'hidden',alignItems:'center',justifyContent:'center'}}>
                <Text style={{fontSize:64}}>🌍</Text>
              </View>
              <Text style={{color:'#4ade80',fontWeight:'900',fontSize:22,marginTop:12}}>🌿 Eco Habit</Text>
            </Animated.View>

            {/* Form */}
            <Animated.View style={{width:'100%',maxWidth:420,opacity:loginFade,transform:[{translateY:loginFade.interpolate({inputRange:[0,1],outputRange:[40,0]})}]}}>
              <Text style={{fontSize:24,fontWeight:'900',color:'#ffffff',textAlign:'center',marginBottom:4}}>
                Hey there! 👋
              </Text>
              <Text style={{color:'#86efac',textAlign:'center',fontSize:14,marginBottom:24}}>
                New or returning — just fill in your details below
              </Text>

              {/* Email */}
              <Text style={{color:'#86efac',fontSize:13,fontWeight:'700',marginBottom:6}}>Your email</Text>
              <TextInput
                style={{backgroundColor:'rgba(255,255,255,0.1)',borderWidth:1,borderColor:'rgba(134,239,172,0.3)',borderRadius:14,padding:14,color:'#ffffff',marginBottom:16,fontSize:15}}
                placeholder="Your email"
                placeholderTextColor="#6b9e80"
                value={login.email} onChangeText={v=>setLogin(p=>({...p,email:v}))}
                autoCapitalize="none" keyboardType="email-address"
              />

              {/* Password */}
              <Text style={{color:'#86efac',fontSize:13,fontWeight:'700',marginBottom:2}}>Your Eco Habit password</Text>
              <Text style={{color:'rgba(110,231,183,0.6)',fontSize:11,marginBottom:6}}>Not your Gmail password — create a new one just for this app</Text>
              <View style={{flexDirection:'row',alignItems:'center',backgroundColor:'rgba(255,255,255,0.1)',borderWidth:1,borderColor:'rgba(134,239,172,0.3)',borderRadius:14,marginBottom:16}}>
                <TextInput
                  style={{flex:1,padding:14,color:'#ffffff',fontSize:15}}
                  placeholder="Your password"
                  placeholderTextColor="#6b9e80"
                  value={login.password} onChangeText={v=>setLogin(p=>({...p,password:v}))}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={()=>setShowPassword(p=>!p)} style={{paddingHorizontal:14}}>
                  <Text style={{fontSize:18}}>{showPassword?'🙈':'👁️'}</Text>
                </TouchableOpacity>
              </View>

              {/* Username (new accounts only) */}
              <TouchableOpacity onPress={()=>setIsSignup(p=>!p)} style={{marginBottom:8}}>
                <Text style={{color:'#86efac',fontSize:13,textAlign:'center'}}>
                  {isSignup ? '▾ Already have an account? Hide this' : '▸ New here? Create your username'}
                </Text>
              </TouchableOpacity>
              {isSignup&&(
                <>
                  <Text style={{color:'#86efac',fontSize:12,marginBottom:6,opacity:0.8}}>👤 Pick a username — this is shown on the leaderboard</Text>
                  <TextInput
                    style={{backgroundColor:'rgba(255,255,255,0.1)',borderWidth:1,borderColor:'rgba(134,239,172,0.3)',borderRadius:14,padding:14,color:'#ffffff',marginBottom:16,fontSize:15}}
                    placeholder="e.g. greenplant42"
                    placeholderTextColor="#6b9e80"
                    value={signupUsername} onChangeText={setSignupUsername}
                    autoCapitalize="none" autoCorrect={false}
                  />
                </>
              )}

              {forgotMode ? (
                <View style={{backgroundColor:'rgba(255,255,255,0.07)',borderRadius:14,padding:16,marginTop:4}}>
                  <Text style={{color:'#fff',fontWeight:'800',fontSize:16,marginBottom:4,textAlign:'center'}}>🔑 Reset Password</Text>
                  <Text style={{color:'#86efac',fontSize:13,marginBottom:12,textAlign:'center'}}>Enter your email and we'll send a reset link</Text>
                  <TextInput
                    style={{backgroundColor:'rgba(255,255,255,0.1)',borderWidth:1,borderColor:'rgba(134,239,172,0.3)',borderRadius:14,padding:14,color:'#fff',marginBottom:12,fontSize:15}}
                    placeholder="Your email" placeholderTextColor="#6b9e80"
                    value={forgotEmail} onChangeText={setForgotEmail}
                    autoCapitalize="none" keyboardType="email-address"
                  />
                  {forgotSent
                    ? <>
                        <Text style={{color:'#4ade80',textAlign:'center',fontWeight:'700',fontSize:14,marginBottom:4}}>✅ Reset link sent!</Text>
                        <Text style={{color:'#86efac',textAlign:'center',fontSize:12,marginBottom:8}}>Can't find it? Check your spam or junk folder 📂</Text>
                      </>
                    : <>
                        <TouchableOpacity style={{backgroundColor:'#22c55e',borderRadius:14,paddingVertical:14,alignItems:'center',marginBottom:6}} onPress={handleForgotPassword}>
                          <Text style={{color:'#fff',fontWeight:'900',fontSize:15}}>Send Reset Link 📧</Text>
                        </TouchableOpacity>
                        <Text style={{color:'#86efac',fontSize:11,textAlign:'center',opacity:0.8}}>📂 Email may land in your spam or junk folder</Text>
                      </>
                  }
                  <TouchableOpacity onPress={resetRecovery} style={{alignSelf:'center',padding:8,marginTop:4}}>
                    <Text style={{color:'#86efac',fontSize:13}}>← Back to login</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity style={{backgroundColor:'#22c55e',borderRadius:14,paddingVertical:16,alignItems:'center',marginTop:4}} onPress={handleLogin}>
                    <Text style={{color:'#fff',fontWeight:'900',fontSize:17}}>Let's Go! 🌿</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={()=>setForgotMode(true)} style={{alignSelf:'center',marginTop:12,padding:8}}>
                    <Text style={{color:'#86efac',fontSize:13}}>Forgot password?</Text>
                  </TouchableOpacity>
                </>
              )}
            </Animated.View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // ── Username Setup (existing users with no username) ─────────────────────
  if (needsUsername) {
    return (
      <SafeAreaView style={{flex:1,backgroundColor:'#011a12',minHeight:'100vh' as any}}>
        <LinearGradient colors={['#011a12','#022c22','#064e3b']} style={{flex:1,minHeight:'100vh' as any,alignItems:'center',justifyContent:'center',padding:24}} start={[0,0]} end={[1,1]}>
          <Text style={{fontSize:32,marginBottom:12}}>👤</Text>
          <Text style={{color:'#fff',fontSize:20,fontWeight:'900',marginBottom:6}}>One last thing!</Text>
          <Text style={{color:'#6ee7b7',fontSize:14,marginBottom:28,textAlign:'center'}}>Pick a username — shown on the leaderboard</Text>
          <TextInput
            style={{width:'100%',maxWidth:360,backgroundColor:'rgba(255,255,255,0.08)',borderWidth:1,borderColor:'rgba(110,231,183,0.3)',borderRadius:14,padding:14,color:'#fff',fontSize:15,marginBottom:16}}
            placeholder="e.g. greenplant42"
            placeholderTextColor="rgba(110,231,183,0.5)"
            value={pendingUsername}
            onChangeText={setPendingUsername}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={{width:'100%',maxWidth:360,backgroundColor:'#10b981',borderRadius:14,paddingVertical:15,alignItems:'center'}}
            onPress={async()=>{
              const uname = pendingUsername.trim().toLowerCase();
              if (!uname) { alert('Enter a username'); return; }
              if (!/^[a-z0-9_]{3,20}$/.test(uname)) { alert('3–20 chars, letters/numbers/underscore only'); return; }
              if (firebaseUser) {
                await setDoc(doc(db,'eco_users',firebaseUser.uid),{username:uname},{merge:true});
                await AsyncStorage.setItem('eco_username', uname);
              }
              setUsername(uname);
              setNeedsUsername(false);
            }}>
            <Text style={{color:'#fff',fontWeight:'900',fontSize:16}}>Save Username 🌿</Text>
          </TouchableOpacity>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // ── Main Screen ───────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={{flex:1,backgroundColor:'#011a12',minHeight:'100vh' as any}}>
      <StatusBar style="light"/>

      {/* Tab bar */}
      <View style={{flexDirection:'row',backgroundColor:'#011a12',borderTopWidth:1,borderTopColor:'#1e5c3e',position:'absolute' as any,bottom:0,left:0,right:0,zIndex:100,paddingBottom:8,paddingTop:8}}>
        {([
          {id:'home',      label:'🏠 Home',        },
          {id:'leaderboard',label:'🏆 Leaderboard'},
        ] as const).map(tab=>(
          <TouchableOpacity key={tab.id} style={{flex:1,alignItems:'center',paddingVertical:6}}
            onPress={()=>{
              setActiveTab(tab.id);
              if(tab.id==='leaderboard') fetchLeaderboard();
            }}>
            <Text style={{fontSize:13,fontWeight:'700',color:activeTab===tab.id?'#4ade80':'#4d9e7a'}}>{tab.label}</Text>
            {activeTab===tab.id&&<View style={{width:24,height:3,backgroundColor:'#4ade80',borderRadius:2,marginTop:3}}/>}
          </TouchableOpacity>
        ))}
      </View>

      {/* Leaderboard tab */}
      {activeTab==='leaderboard'&&(
        <ScrollView style={{flex:1,marginBottom:60}}>
          <LinearGradient colors={['#011a12','#022c22','#064e3b']} style={{paddingTop:18,paddingBottom:26,paddingHorizontal:20,marginBottom:4}} start={[0,0]} end={[1,1]}>
            <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
              <View style={{width:70}}/>
              <Text style={{fontSize:22,fontWeight:'900',color:'#fff'}}>🏆 Leaderboard</Text>
              <TouchableOpacity onPress={()=>fetchLeaderboard(true)} style={{backgroundColor:'#1e5c3e',borderRadius:20,paddingHorizontal:12,paddingVertical:6}}>
                <Text style={{color:'#4ade80',fontWeight:'700',fontSize:12}}>↻ Refresh</Text>
              </TouchableOpacity>
            </View>
            <Text style={{color:'#6ee7b7',fontSize:12,textAlign:'center',marginTop:4}}>Top Eco Warriors worldwide</Text>
          </LinearGradient>
          <View style={{padding:16,marginBottom:60}}>
            {lbLoading&&<Text style={{color:'#9ca3af',textAlign:'center',marginTop:40,fontSize:15}}>Loading...</Text>}
            {!lbLoading&&leaderboard.length===0&&<Text style={{color:'#9ca3af',textAlign:'center',marginTop:40,fontSize:15}}>No data yet. Be the first! 🌱</Text>}
            {leaderboard.map((u,i)=>{
              const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
              const isMe  = u.username===username;
              return (
                <View key={i} style={{flexDirection:'row',alignItems:'center',backgroundColor:isMe?'#dcfce7':'#f9fafb',borderRadius:16,padding:14,marginBottom:10,borderWidth:isMe?2:0,borderColor:'#22c55e'}}>
                  <Text style={{fontSize:20,width:40,textAlign:'center',fontWeight:'900'}}>{medal}</Text>
                  <View style={{flex:1,marginLeft:8}}>
                    <Text style={{fontWeight:'800',fontSize:15,color:'#111827'}}>{u.username}{isMe?' (you)':''}</Text>
                    <Text style={{color:'#6b7280',fontSize:12,marginTop:2}}>Level {u.level} · 🔥 {u.streak} day streak</Text>
                  </View>
                  <View style={{alignItems:'flex-end'}}>
                    <Text style={{fontWeight:'900',fontSize:16,color:'#059669'}}>{u.xp} XP</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}

      {/* Home tab */}
      {activeTab==='home'&&<ScrollView style={{flex:1,minHeight:'100vh' as any,marginBottom:60}}>

        {/* ── Hero Header ── */}
        <LinearGradient colors={['#011a12','#022c22','#064e3b']} style={{paddingTop:18,paddingBottom:26,paddingHorizontal:isWide?40:20,borderBottomLeftRadius:28,borderBottomRightRadius:28,marginBottom:4}} start={[0,0]} end={[1,1]}>
          <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <Text style={{fontSize:18,fontWeight:'900',color:'#fff'}}>🌿 Eco Habit</Text>
            <View style={{flexDirection:'row',gap:8}}>
              <TouchableOpacity onPress={()=>{setActiveTab('leaderboard');fetchLeaderboard();}} style={{backgroundColor:'#6366f1',borderRadius:20,paddingHorizontal:14,paddingVertical:6}}>
                <Text style={{color:'#fff',fontWeight:'700',fontSize:12}}>🏆 Leaderboard</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleLogout} style={{backgroundColor:'#f59e0b',borderRadius:20,paddingHorizontal:14,paddingVertical:6}}>
                <Text style={{color:'#fff',fontWeight:'700',fontSize:12}}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={{color:'#6ee7b7',fontSize:12,marginBottom:14}}>
            {username||'Eco Warrior'} · {globalStreak>0?`🌱 ${globalStreak}-day streak!`:'🌱 Start your journey!'}
          </Text>
          <View style={{flexDirection:'row',alignItems:'center',marginBottom:16}}>
            <View style={{flex:1,alignItems:'center'}}>
              <Text style={{color:'#fff',fontSize:18,fontWeight:'900'}}>⭐ {level}</Text>
              <Text style={{color:'#4d9e7a',fontSize:10,fontWeight:'600',marginTop:2}}>Level</Text>
            </View>
            <View style={{width:1,height:36,backgroundColor:'#1e5c3e'}}/>
            <View style={{flex:1,alignItems:'center'}}>
              <Text style={{color:'#fff',fontSize:18,fontWeight:'900'}}>🔥 {globalStreak}</Text>
              <Text style={{color:'#4d9e7a',fontSize:10,fontWeight:'600',marginTop:2}}>Streak</Text>
            </View>
            <View style={{width:1,height:36,backgroundColor:'#1e5c3e'}}/>
            <View style={{flex:1,alignItems:'center'}}>
              <Text style={{color:'#fff',fontSize:18,fontWeight:'900'}}>{xp}</Text>
              <Text style={{color:'#4d9e7a',fontSize:10,fontWeight:'600',marginTop:2}}>XP</Text>
            </View>
          </View>
          <View style={{height:12,backgroundColor:'#1a4a35',borderRadius:8,overflow:'hidden',marginBottom:5}}>
            <View style={{position:'absolute',height:'100%',width:`${percentage}%` as any,backgroundColor:'#38bdf8',borderRadius:8}}/>
          </View>
          <Text style={{color:'#4d9e7a',fontSize:10,fontWeight:'600'}}>{progress}/{required} XP · Level {level+1} unlocks soon</Text>
        </LinearGradient>

        <View style={{padding:isWide?28:14,paddingBottom:48,alignItems:'center'}}>
        <View style={{width:'100%',maxWidth:isWide?900:undefined}}>


          {/* Two column layout on wide screens */}
          <View style={{flexDirection:isWide?'row':'column',gap:16,alignItems:'flex-start'}}>
            <View style={{flex:isWide?1:undefined,width:isWide?undefined:'100%'}}>

              {/* Streak Tree */}
              <View style={[ws.card,{backgroundColor:'#f3e8ff'}]}>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                  <Text style={ws.section}>Streak Tree</Text>
                  <Text style={{fontSize:13,color:'#6b7280',fontWeight:'600'}}>{globalStreak>0?`🔥 ${globalStreak} days`:'No streak yet'}</Text>
                </View>
                <StreakTree streak={globalStreak} broken={streakBroken}/>
                <View style={{flexDirection:'row',justifyContent:'center',gap:6,marginTop:8}}>
                  {Array.from({length:7}).map((_,i)=>(
                    <View key={i} style={{width:12,height:12,borderRadius:6,
                      backgroundColor:i<globalStreak%7||(globalStreak>0&&globalStreak%7===0)?'#22c55e':'#d1fae5',
                      borderWidth:i<globalStreak%7||(globalStreak>0&&globalStreak%7===0)?0:1,borderColor:'#86efac'}}/>
                  ))}
                </View>
              </View>

              {/* Carbon Impact */}
              {(()=>{
                const allDeeds = DEFAULT_DEED_CATEGORIES.flatMap(c=>c.deeds);
                const completed = habits.filter(h=>h.completed);
                const totalKg = calcCarbonKg(completed, allDeeds);
                const badge = totalKg===0?'Keep going! 💪':totalKg<2?'Nice start! 🌱':totalKg<10?'Eco Hero! 🌿':totalKg<30?'Super Green! 🌳':'Earth Champion! 🌍';
                return (
                  <View style={[ws.card,{backgroundColor:'#ecfdf5',borderWidth:2,borderColor:'#6ee7b7'}]}>
                    <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                      <Text style={[ws.section,{color:'#064e3b'}]}>🌍 Planet Impact</Text>
                      <View style={{backgroundColor:'#059669',borderRadius:20,paddingHorizontal:10,paddingVertical:4}}>
                        <Text style={{color:'#fff',fontWeight:'800',fontSize:11}}>{badge}</Text>
                      </View>
                    </View>
                    <Text style={{fontSize:28,fontWeight:'900',color:'#059669',textAlign:'center'}}>{totalKg.toFixed(2)} kg CO₂</Text>
                    <Text style={{fontSize:13,color:'#047857',textAlign:'center',marginBottom:8}}>saved so far 🌱</Text>
                    {totalKg===0
                      ?<Text style={{color:'#9ca3af',textAlign:'center',fontStyle:'italic',fontSize:12}}>Complete habits to see your impact!</Text>
                      :DEFAULT_DEED_CATEGORIES.map(cat=>{
                        const kg=calcCarbonKg(completed.filter(h=>cat.deeds.map(d=>d.label).includes(h.title)),cat.deeds);
                        if(kg===0)return null;
                        return(
                          <View key={cat.id} style={{flexDirection:'row',alignItems:'center',marginBottom:5}}>
                            <Text style={{fontSize:16,width:24}}>{cat.deeds[0]?.emoji}</Text>
                            <Text style={{flex:1,fontSize:12,fontWeight:'600',color:'#374151'}}>{cat.name}</Text>
                            <Text style={{fontSize:12,fontWeight:'800',color:'#059669'}}>{kg.toFixed(2)} kg ✓</Text>
                          </View>
                        );
                      })
                    }
                  </View>
                );
              })()}

              {/* Eco Tree Dashboard */}
              <View style={[ws.card,{backgroundColor:'#e0f2fe'}]}>
                <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                  <View>
                    <Text style={ws.section}>🌳 Eco Tree Dashboard</Text>
                    <Text style={{fontSize:12,color:'#6b7280',marginTop:2}}>{treeStage} · {Math.round(treeCompletion*100)}%</Text>
                  </View>
                  <View style={{width:46,height:46,borderRadius:23,backgroundColor:'#0b8457',alignItems:'center',justifyContent:'center'}}>
                    <Text style={{color:'#fff',fontWeight:'900',fontSize:13}}>{Math.round(treeCompletion*100)}%</Text>
                  </View>
                </View>
                <View style={{height:8,backgroundColor:'#e5e7eb',borderRadius:6,overflow:'hidden',marginBottom:14}}>
                  <View style={{height:'100%',width:`${Math.round(treeCompletion*100)}%`,backgroundColor:'#22c55e',borderRadius:6}}/>
                </View>
                <View style={{flexDirection:'row',flexWrap:'wrap',gap:10}}>
                  {categoryProgress.map(cat=>{
                    const pct = cat.total?Math.round((cat.completed/cat.total)*100):0;
                    const done = cat.total>0&&cat.completed===cat.total;
                    const cc = CAT_COLORS[cat.id]??CAT_COLORS.general;
                    const catHabits = habits.filter(h=>cat.deeds.map(d=>d.label).includes(h.title));
                    const expanded = expandedCategory===cat.id;
                    return (
                      <TouchableOpacity key={cat.id} onPress={()=>setExpandedCategory(expanded?null:cat.id)}
                        style={{width:'47%',backgroundColor:cc.bg,borderRadius:16,padding:12,alignItems:'center',borderWidth:done?2:0,borderColor:cc.pill}}>
                        {done&&<View style={{position:'absolute',top:8,right:8,width:20,height:20,borderRadius:10,backgroundColor:cc.pill,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#fff',fontSize:11,fontWeight:'900'}}>✓</Text></View>}
                        <View style={{width:48,height:48,borderRadius:24,backgroundColor:done?cc.pill:'rgba(0,0,0,0.08)',alignItems:'center',justifyContent:'center',marginBottom:8}}>
                          <Text style={{fontSize:22}}>{cat.emoji}</Text>
                        </View>
                        <Text style={{fontWeight:'800',fontSize:13,color:cc.text,textAlign:'center',marginBottom:6}}>{cat.name}</Text>
                        <View style={{width:'100%',height:6,backgroundColor:'rgba(0,0,0,0.1)',borderRadius:4,overflow:'hidden',marginBottom:4}}>
                          <View style={{height:'100%',width:`${pct}%`,backgroundColor:cc.pill,borderRadius:4}}/>
                        </View>
                        <Text style={{fontSize:11,fontWeight:'700',color:cc.text,opacity:0.7}}>{cat.total?`${cat.completed}/${cat.total}`:'No habits'}</Text>
                        {cat.total>0&&<Text style={{fontSize:10,color:cc.text,opacity:0.6,marginTop:3,fontWeight:'600'}}>
                          {cat.completed===0?'Not started 🌱':cat.completed<cat.total?'In progress 🌿':'Complete! 🎉'}
                        </Text>}
                        {expanded&&<View style={{width:'100%',marginTop:10,backgroundColor:'rgba(255,255,255,0.6)',borderRadius:10,padding:8}}>
                          {catHabits.length===0
                            ?<Text style={{fontSize:11,color:'#9ca3af',fontStyle:'italic',textAlign:'center'}}>Add habits in reminders!</Text>
                            :catHabits.map(h=>(
                              <View key={h.id} style={{flexDirection:'row',alignItems:'center',gap:4,marginBottom:4}}>
                                <Text style={{fontSize:12}}>{h.completed?'✅':'⬜'}</Text>
                                <Text style={{flex:1,fontSize:11,fontWeight:'600',color:'#374151',textDecorationLine:h.completed?'line-through':'none'}}>{h.title}</Text>
                                {(h.streak??0)>0&&<Text style={{fontSize:11,fontWeight:'700',color:'#b45309'}}>🔥{h.streak}</Text>}
                              </View>
                            ))
                          }
                        </View>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={{flex:isWide?1:undefined,width:isWide?undefined:'100%'}}>

              {/* Add Reminder */}
              <View style={[ws.card,{backgroundColor:'#dcfce7'}]}>
                <Text style={ws.section}>Add reminder</Text>
                <Text style={{color:'#547a56',marginBottom:8,fontSize:13}}>
                  Choose a deed below or make your own, then set a time. ⏰{'\n'}
                  <Text style={{color:'#ff9f1c',fontWeight:'700'}}>Tip: press Auto if due tomorrow.</Text>
                </Text>
                <View style={{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between'}}>
                  {deedCategories.map(category=>{
                    const cc = CAT_COLORS[category.id]??CAT_COLORS.general;
                    return (
                      <View key={category.id} style={{width:'49%',marginBottom:14}}>
                        <View style={{backgroundColor:'#ff9f1c',borderRadius:8,paddingHorizontal:10,paddingVertical:5,marginBottom:8,alignSelf:'flex-start'}}>
                          <Text style={{color:'#fff',fontWeight:'800',fontSize:11,textTransform:'uppercase',letterSpacing:0.8}}>{category.name}</Text>
                        </View>
                        {category.deeds.map(d=>{
                          const active = selectedDeed===d.id;
                          return (
                            <TouchableOpacity key={d.id}
                              style={{paddingVertical:9,paddingHorizontal:10,borderRadius:14,marginBottom:6,flexDirection:'row',alignItems:'center',
                                backgroundColor:active?'#ddd6fe':'#ede9fe',
                                borderWidth:1,borderColor:active?'#7c3aed':'#c4b5fd',minHeight:44}}
                              onPress={()=>setSelectedDeed(d.id)}>
                              <Text style={{marginRight:6,fontSize:15,flexShrink:0}}>{d.emoji}</Text>
                              <Text style={{fontWeight:'700',fontSize:12,color:active?'#4c1d95':'#5b21b6',flexShrink:1,lineHeight:16}}>{d.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    );
                  })}
                </View>

                {/* ── Add Custom Deed ── */}
                <View style={{marginBottom:12,marginTop:4}}>
                  <Text style={{fontSize:11,fontWeight:'800',color:'#ff9f1c',marginBottom:8,textTransform:'uppercase',letterSpacing:0.8}}>My Custom Deeds</Text>
                  {/* Show existing custom deeds as chips */}
                  {customDeeds.length > 0 && (
                    <View style={{flexDirection:'row',flexWrap:'wrap',marginBottom:8}}>
                      {customDeeds.map(d=>{
                        const active=selectedDeed===d.id;
                        return (
                          <View key={d.id} style={{flexDirection:'row',alignItems:'center',marginBottom:6,marginRight:6}}>
                            <TouchableOpacity
                              style={{paddingVertical:8,paddingHorizontal:10,borderRadius:14,flexDirection:'row',alignItems:'center',
                                backgroundColor:active?'#ddd6fe':'#ede9fe',borderWidth:1,borderColor:active?'#7c3aed':'#c4b5fd'}}
                              onPress={()=>setSelectedDeed(d.id)}>
                              <Text style={{marginRight:6,fontSize:14}}>{d.emoji}</Text>
                              <Text style={{fontWeight:'700',fontSize:12,color:active?'#4c1d95':'#5b21b6'}}>{d.label}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={()=>{if(selectedDeed===d.id)setSelectedDeed(null);setCustomDeeds(prev=>prev.filter(x=>x.id!==d.id));}}
                              style={{marginLeft:4,paddingHorizontal:6,paddingVertical:4,backgroundColor:'#fee2e2',borderRadius:8}}>
                              <Text style={{color:'#ef4444',fontWeight:'800',fontSize:12}}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}
                  <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
                    <TextInput style={{...ws.input,width:48,marginBottom:0,textAlign:'center'}} placeholder="🌿" value={newDeedEmoji} onChangeText={setNewDeedEmoji}/>
                    <TextInput style={{...ws.input,flex:1,marginBottom:0}} placeholder="Add your own deed..." value={newDeedLabel} onChangeText={setNewDeedLabel}/>
                    <TouchableOpacity
                      style={{backgroundColor:'#845ef7',borderRadius:10,paddingHorizontal:14,paddingVertical:10}}
                      onPress={()=>{
                        if (!newDeedLabel.trim()){alert('Enter a deed label');return;}
                        const id=`${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
                        setCustomDeeds(prev=>[...prev,{id,label:newDeedLabel.trim(),emoji:newDeedEmoji||'✅'}]);
                        setSelectedDeed(id);
                        setNewDeedLabel(''); setNewDeedEmoji('');
                      }}>
                      <Text style={{color:'#fff',fontWeight:'800',fontSize:13}}>+ Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Row 1: time + AM/PM */}
                <View style={{flexDirection:'row',alignItems:'center',marginBottom:8,gap:6}}>
                  <TextInput style={{...ws.input,flex:1,marginBottom:0}} placeholder="Time (HH:MM)" value={time} onChangeText={setTime}/>
                  <View style={{flexDirection:'row',gap:4}}>
                    {(['AM','PM'] as const).map(ap=>(
                      <TouchableOpacity key={ap} style={{paddingHorizontal:12,paddingVertical:8,borderRadius:8,backgroundColor:ampm===ap?'#06c39a':'#fff6f0',borderWidth:1,borderColor:ampm===ap?'#06c39a':'#d1fae5'}}
                        onPress={()=>setAmpm(ap)}>
                        <Text style={{color:ampm===ap?'#fff':'#2a6f3d',fontWeight:'700'}}>{ap}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
                {/* Row 2: date + auto */}
                <View style={{flexDirection:'row',alignItems:'center',marginBottom:8,gap:6}}>
                  <TextInput style={{...ws.input,flex:1,marginBottom:0}} placeholder="Date (MM-DD)" value={date} onChangeText={setDate}/>
                  <TouchableOpacity style={{paddingHorizontal:14,paddingVertical:8,backgroundColor:'#ffd166',borderRadius:8}}
                    onPress={()=>{
                      const next=computeNextDateString(`${time||'08:00'} ${ampm}`);
                      if (!next){alert('Check time format');return;}setDate(next);
                    }}>
                    <Text style={{color:'#6b3d6b',fontWeight:'700',fontSize:12}}>Auto</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity style={{backgroundColor:'#845ef7',paddingVertical:10,borderRadius:10,alignItems:'center'}} onPress={add}>
                  <Text style={{color:'#fff',fontWeight:'800'}}>Add Reminder</Text>
                </TouchableOpacity>
              </View>

              {/* Upcoming */}
              <View style={[ws.card,{backgroundColor:'#fce7f3'}]}>
                <Text style={ws.section}>Upcoming</Text>
                {upcoming.length===0
                  ?<Text style={{color:'#9ca3af',textAlign:'center',paddingVertical:16}}>No upcoming reminders</Text>
                  :<FlatList
                    data={upcoming} keyExtractor={i=>i.id} scrollEnabled={false}
                    renderItem={({item})=>(
                      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingVertical:10,borderBottomWidth:1,borderBottomColor:'#f3f4f6'}}>
                        <View style={{flex:1,paddingRight:8}}>
                          <View style={{flexDirection:'row',alignItems:'center',flexWrap:'wrap'}}>
                            <Text style={{fontSize:14,fontWeight:'600',color:item.completed?'#9ca3af':'#111827',textDecorationLine:item.completed?'line-through':'none'}}>{item.title}</Text>
                            {(item.streak??0)>0&&<View style={{marginLeft:6,backgroundColor:'#fff7ed',paddingHorizontal:6,paddingVertical:2,borderRadius:10}}>
                              <Text style={{fontSize:11,fontWeight:'700',color:'#f97316'}}>🔥 {item.streak}</Text>
                            </View>}
                          </View>
                          <Text style={{color:'#9ca3af',fontSize:12,marginTop:2}}>{item.time}</Text>
                        </View>
                        <View style={{flexDirection:'row',gap:6}}>
                          <TouchableOpacity style={{backgroundColor:'#22c55e',paddingVertical:5,paddingHorizontal:12,borderRadius:20}} onPress={()=>toggle(item.id)}>
                            <Text style={{color:'#fff',fontWeight:'700',fontSize:12}}>{item.completed?'Undo':'Done'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={{backgroundColor:'#fee2e2',paddingVertical:5,paddingHorizontal:12,borderRadius:20}} onPress={()=>remove(item.id)}>
                            <Text style={{color:'#ef4444',fontWeight:'700',fontSize:12}}>Delete</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  />
                }
                {upcoming.length>0&&<TouchableOpacity onPress={clearCompleted} style={{marginTop:12,alignItems:'center'}}>
                  <Text style={{color:'#9ca3af',fontSize:13}}>Clear completed</Text>
                </TouchableOpacity>}
              </View>

            </View>
          </View>

          <Text style={{color:'#9ca3af',textAlign:'center',fontSize:12,marginTop:8}}>Made with ♻️ and 🌱</Text>
        </View>
        </View>
      </ScrollView>}

    </SafeAreaView>
  );
}

const ws = StyleSheet.create({
  card:    { backgroundColor:'#ffffff', borderRadius:20, padding:16, marginBottom:12, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:8, shadowOffset:{width:0,height:2} },
  section: { fontSize:15, fontWeight:'700', color:'#111827', marginBottom:4 },
  input:   { borderWidth:1, borderColor:'#f3e8ff', borderRadius:10, padding:10, marginBottom:8, backgroundColor:'#fffaf6', fontSize:14 },
});
