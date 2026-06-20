import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ConfettiCannon from 'react-native-confetti-cannon';
import { LinearGradient } from 'expo-linear-gradient';
let Notifications: any = null;
try {
  Notifications = require('expo-notifications');
} catch (e) {
  Notifications = null;
}
import {
  Alert,
  Animated,
  Button,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { auth, db } from './firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  deleteUser,
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, getDocsFromServer, query, where } from 'firebase/firestore';

type Habit = {
  id: string;
  title: string;
  time: string;
  completed: boolean;
  streak: number;
  lastCompletedDate: string | null;
};
type LoginState = { email: string; password: string };
type Credentials = { email: string; password?: string };

const XP_PER = 10;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Carbon savings per deed (grams CO₂, EPA/IPCC data) ──────────────────────
const CO2_SAVINGS_G: Record<string, number> = {
  'public-transport': 2600, 'walk': 2600, 'stairs': 50, 'zoom': 5000,
  'reuse': 33, 'reusable-cup': 80, 'recycled-plastic': 200,
  'bottle': 80, 'plants': 10, 'recycle': 300, 'segregate': 150,
  'switch-off': 200, 'lower-hvac': 500, 'solar': 1500,
  'full-appliances': 300, 'repair': 500, 'plant-diet': 1500,
  'eco-shopping': 200, 'compost': 300, 'sustainable': 500,
};

function calcCarbonKg(completedHabits: { title: string }[], allDeeds: { id: string; label: string }[]): number {
  return completedHabits.reduce((sum, h) => {
    const deed = allDeeds.find(d => d.label === h.title);
    return sum + (deed ? (CO2_SAVINGS_G[deed.id] ?? 300) : 0);
  }, 0) / 1000;
}

// ─── Streak Tree Component ────────────────────────────────────────────────────

type TreeConfig = {
  tiers: number;
  canopyW: number;
  canopyH: number;
  trunkH: number;
  trunkW: number;
  color: string;
  label: string;
};

const TREE_CONFIGS: (TreeConfig | null)[] = [
  null, // level 0 = stump (handled separately)
  { tiers: 1, canopyW: 44,  canopyH: 30,  trunkH: 14, trunkW: 8,  color: '#86efac', label: 'Seedling' },
  { tiers: 1, canopyW: 72,  canopyH: 50,  trunkH: 22, trunkW: 12, color: '#4ade80', label: 'Sapling' },
  { tiers: 2, canopyW: 104, canopyH: 66,  trunkH: 34, trunkW: 16, color: '#22c55e', label: 'Young Tree' },
  { tiers: 2, canopyW: 136, canopyH: 84,  trunkH: 46, trunkW: 20, color: '#16a34a', label: 'Mature Tree' },
  { tiers: 3, canopyW: 164, canopyH: 102, trunkH: 58, trunkW: 22, color: '#15803d', label: 'Great Tree' },
  { tiers: 3, canopyW: 196, canopyH: 122, trunkH: 70, trunkW: 26, color: '#14532d', label: '🌟 Mighty Oak' },
];

function StreakTree({ streak, broken }: { streak: number; broken: boolean }) {
  const level =
    broken || streak === 0 ? 0
    : streak <= 2  ? 1
    : streak <= 6  ? 2
    : streak <= 13 ? 3
    : streak <= 20 ? 4
    : streak <= 29 ? 5
    : 6;

  if (level === 0) {
    return (
      <View style={treeStyles.container}>
        <Text style={treeStyles.axe}>🪓</Text>
        <View style={treeStyles.stump} />
        <Text style={treeStyles.brokenLabel}>
          {broken ? 'Streak broken! Start fresh 🌱' : 'Complete a habit to grow your tree!'}
        </Text>
      </View>
    );
  }

  const cfg = TREE_CONFIGS[level]!;

  return (
    <View style={treeStyles.container}>
      {/* Canopy — tiers stack top-to-bottom, each slightly wider */}
      <View style={{ alignItems: 'center' }}>
        {cfg.tiers >= 3 && (
          <View style={[treeStyles.canopyTier, {
            width: cfg.canopyW * 0.52,
            height: cfg.canopyH * 0.52,
            backgroundColor: cfg.color,
            borderRadius: cfg.canopyW,
            marginBottom: -(cfg.canopyH * 0.14),
            opacity: 0.85,
          }]} />
        )}
        {cfg.tiers >= 2 && (
          <View style={[treeStyles.canopyTier, {
            width: cfg.canopyW * 0.78,
            height: cfg.canopyH * 0.74,
            backgroundColor: cfg.color,
            borderRadius: cfg.canopyW,
            marginBottom: -(cfg.canopyH * 0.16),
            opacity: 0.92,
          }]} />
        )}
        <View style={[treeStyles.canopyTier, {
          width: cfg.canopyW,
          height: cfg.canopyH,
          backgroundColor: cfg.color,
          borderRadius: cfg.canopyW / 1.4,
        }]} />
      </View>

      {/* Trunk */}
      <View style={[treeStyles.trunk, { width: cfg.trunkW, height: cfg.trunkH }]} />

      {/* Label */}
      <Text style={treeStyles.treeLabel}>
        {cfg.label} · 🔥 {streak} day{streak !== 1 ? 's' : ''}
      </Text>
    </View>
  );
}

const treeStyles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 14 },
  axe:        { fontSize: 40 },
  stump:      { width: 40, height: 22, backgroundColor: '#92400e', borderRadius: 4, marginTop: 6 },
  brokenLabel:{ color: '#ef4444', fontWeight: '800', marginTop: 10, fontSize: 14, textAlign: 'center' },
  canopyTier: { zIndex: 1 },
  trunk:      { backgroundColor: '#92400e', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  treeLabel:  { color: '#0b8457', fontWeight: '800', marginTop: 10, fontSize: 14 },
});

// ─── Web Confetti via canvas-confetti CDN ─────────────────────────────────────

function fireWebConfetti() {
  if (Platform.OS !== 'web') return;
  try {
    const win = window as any;
    if (win.confetti) {
      win.confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#4ade80','#22c55e','#facc15','#fb923c','#60a5fa','#f472b6','#a78bfa'],
      });
      return;
    }
    // Load script if not already loaded
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js';
    script.onload = () => {
      (window as any).confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#4ade80','#22c55e','#facc15','#fb923c','#60a5fa','#f472b6','#a78bfa'],
      });
    };
    document.head.appendChild(script);
  } catch {}
}

// ─── Earth Mascot Component ───────────────────────────────────────────────────

function EarthMascot() {
  const bounce = useRef(new Animated.Value(0)).current;
  const armL   = useRef(new Animated.Value(0)).current;
  const armR   = useRef(new Animated.Value(0)).current;
  const legL   = useRef(new Animated.Value(0)).current;
  const legR   = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (anim: Animated.Value, toValue: number, duration: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0,      duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      );

    const b  = loop(bounce, -22, 350);
    const al = loop(armL,    1,  280);
    const ar = loop(armR,   -1,  280);
    const ll = loop(legL,    1,  280);
    const lr = loop(legR,   -1,  280);

    b.start(); al.start(); ar.start(); ll.start(); lr.start();
    return () => { b.stop(); al.stop(); ar.stop(); ll.stop(); lr.stop(); };
  }, []);

  const armLRot = armL.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '45deg'] });
  const armRRot = armR.interpolate({ inputRange: [-1, 0], outputRange: ['45deg', '-25deg'] });
  const legLRot = legL.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '20deg'] });
  const legRRot = legR.interpolate({ inputRange: [-1, 0], outputRange: ['20deg', '-20deg'] });

  return (
    <View style={earthStyles.scene}>
      <Animated.View style={[earthStyles.characterWrap, { transform: [{ translateY: bounce }] }]}>
        {/* Body row: left arm + globe + right arm */}
        <View style={earthStyles.bodyRow}>
          {/* Left arm */}
          <Animated.View style={[earthStyles.arm, earthStyles.armLeft, { transform: [{ rotate: armLRot }] }]} />

          {/* Globe body */}
          <View style={earthStyles.globe}>
            {/* Continents */}
            <View style={[earthStyles.continent, { width: 30, height: 26, top: 16, left: 10, transform: [{ rotate: '-20deg' }], borderRadius: 14 }]} />
            <View style={[earthStyles.continent, { width: 22, height: 32, top: 8,  left: 44, transform: [{ rotate: '10deg'  }], borderRadius: 12 }]} />
            <View style={[earthStyles.continent, { width: 36, height: 20, top: 48, left: 28, transform: [{ rotate: '-10deg' }], borderRadius: 10 }]} />
            <View style={[earthStyles.continent, { width: 16, height: 22, top: 60, left: 68, transform: [{ rotate: '15deg'  }], borderRadius: 9  }]} />
            {/* Eyes */}
            <View style={earthStyles.face}>
              <View style={earthStyles.eyeRow}>
                <View style={earthStyles.eye}><View style={earthStyles.pupil} /></View>
                <View style={earthStyles.eye}><View style={earthStyles.pupil} /></View>
              </View>
              {/* Blush */}
              <View style={earthStyles.blushRow}>
                <View style={earthStyles.blush} />
                <View style={{ width: 28 }} />
                <View style={earthStyles.blush} />
              </View>
              {/* Smile */}
              <View style={earthStyles.smile} />
            </View>
          </View>

          {/* Right arm */}
          <Animated.View style={[earthStyles.arm, earthStyles.armRight, { transform: [{ rotate: armRRot }] }]} />
        </View>

        {/* Legs */}
        <View style={earthStyles.legRow}>
          <View style={earthStyles.legWrap}>
            <Animated.View style={[earthStyles.leg, { transform: [{ rotate: legLRot }] }]} />
            <View style={earthStyles.foot} />
          </View>
          <View style={earthStyles.legWrap}>
            <Animated.View style={[earthStyles.leg, { transform: [{ rotate: legRRot }] }]} />
            <View style={earthStyles.foot} />
          </View>
        </View>
      </Animated.View>

      {/* Shadow */}
      <View style={earthStyles.shadow} />
    </View>
  );
}

const earthStyles = StyleSheet.create({
  scene:         { alignItems: 'center', paddingVertical: 8 },
  characterWrap: { alignItems: 'center' },
  bodyRow:       { flexDirection: 'row', alignItems: 'flex-end' },
  arm:           { width: 14, height: 46, backgroundColor: '#4CAF7D', borderRadius: 10 },
  armLeft:       { marginRight: -5, borderRadius: 10, transformOrigin: 'top center' } as any,
  armRight:      { marginLeft: -5,  borderRadius: 10, transformOrigin: 'top center' } as any,
  globe:         { width: 100, height: 100, borderRadius: 50, backgroundColor: '#2196A8', borderWidth: 3, borderColor: '#1a7a85', overflow: 'hidden', position: 'relative' },
  continent:     { position: 'absolute', backgroundColor: '#4CAF7D' },
  face:          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  eyeRow:        { flexDirection: 'row', gap: 16, marginBottom: 6 },
  eye:           { width: 16, height: 18, backgroundColor: 'white', borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  pupil:         { width: 9, height: 10, backgroundColor: '#1a1a2e', borderRadius: 5 },
  blushRow:      { flexDirection: 'row', alignItems: 'center', marginBottom: 5 },
  blush:         { width: 12, height: 7, backgroundColor: 'rgba(255,120,120,0.5)', borderRadius: 6 },
  smile:         { width: 26, height: 12, borderBottomWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderColor: 'white', borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  legRow:        { flexDirection: 'row', gap: 10, marginTop: -3 },
  legWrap:       { alignItems: 'center' },
  leg:           { width: 18, height: 42, backgroundColor: '#2196A8', borderRadius: 9, borderWidth: 3, borderColor: '#1a7a85' },
  foot:          { width: 24, height: 12, backgroundColor: '#1a7a85', borderRadius: 7, marginTop: -3 },
  shadow:        { width: 70, height: 12, backgroundColor: 'rgba(0,0,0,0.18)', borderRadius: 35, marginTop: 6 },
});

// ─── Main App ─────────────────────────────────────────────────────────────────

const DEFAULT_DEED_CATEGORIES: { id: string; name: string; deeds: Array<{ id: string; label: string; emoji: string }> }[] = [
  {
    id: 'transport',
    name: 'Transport',
    deeds: [
      { id: 'public-transport', label: 'Took public transport', emoji: '🚌' },
      { id: 'walk',             label: 'Walk or Bike',          emoji: '🚴' },
      { id: 'stairs',           label: 'Took Stairs',           emoji: '🚶' },
      { id: 'zoom',             label: 'Use Zoom Rather Than Travelling', emoji: '💻' },
    ],
  },
  {
    id: 'plastic',
    name: 'Say No to Plastic',
    deeds: [
      { id: 'reuse',           label: 'Use Reusable Bag',       emoji: '🛍️' },
      { id: 'reusable-cup',    label: 'Used Reusable Bottle/cup', emoji: '🥤' },
      { id: 'recycled-plastic',label: 'Recycled plastic',       emoji: '♻️' },
    ],
  },
  {
    id: 'water-waste',
    name: 'Water & Waste',
    deeds: [
      { id: 'bottle',   label: 'Refill Water Bottle', emoji: '💧' },
      { id: 'plants',   label: 'Water Plants',         emoji: '🌿' },
      { id: 'recycle',  label: 'Recycle Waste',        emoji: '♻️' },
      { id: 'segregate',label: 'Segregated Waste',     emoji: '🗑️' },
    ],
  },
  {
    id: 'energy',
    name: 'Energy',
    deeds: [
      { id: 'switch-off', label: 'Switch Off Lights/Fan',  emoji: '💡' },
      { id: 'lower-hvac', label: 'Lower Heating/Cooling',  emoji: '🌡️' },
      { id: 'solar',      label: 'Installed Solar Panel',  emoji: '🔆' },
    ],
  },
  {
    id: 'consumption',
    name: 'Consumption',
    deeds: [
      { id: 'full-appliances', label: 'Run appliances fully loaded',       emoji: '🧺' },
      { id: 'repair',          label: 'Repaired instead of throwing away', emoji: '🛠️' },
      { id: 'plant-diet',      label: 'Plant Based Diet',                  emoji: '🥗' },
      { id: 'eco-shopping',    label: 'Buy Eco Friendly Stuff',            emoji: '🛒' },
      { id: 'compost',         label: 'Made Compost From Peelings',        emoji: '🍂' },
    ],
  },
  {
    id: 'general',
    name: 'General',
    deeds: [
      { id: 'sustainable', label: 'Do Sustainable Eco Deeds', emoji: '🌎' },
    ],
  },
];

export default function App() {
  // ── Deed / category state (must be declared before useMemos that reference them) ──
  const [deedCategories] = useState(DEFAULT_DEED_CATEGORIES);
  const [customDeeds, setCustomDeeds] = useState<Array<{ id: string; label: string; emoji: string }>>([]);
  const deeds = [...DEFAULT_DEED_CATEGORIES.flatMap((c) => c.deeds), ...customDeeds];
  const [newDeedLabel, setNewDeedLabel] = useState('');
  const [newDeedEmoji, setNewDeedEmoji] = useState('');

  // ── Core state ────────────────────────────────────────────────────────────────
  const [time, setTime] = useState('08:00');
  const [ampm, setAmpm] = useState<'AM' | 'PM'>('AM');
  const [selectedDeed, setSelectedDeed] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [habits, setHabits] = useState<Habit[]>([]);
  const [notifMap, setNotifMap] = useState<Record<string, string>>({});
  const [xp, setXp] = useState(0);
  const [lifetimeCarbonKg, setLifetimeCarbonKg] = useState(0);
  const [now, setNow] = useState(new Date());
  const confettiRef = useRef<any>(null);

  // ── Auth state ────────────────────────────────────────────────────────────────
  const [loggedIn, setLoggedIn] = useState(false);
  const [login, setLogin] = useState<{ email: string; password: string }>({ email: '', password: '' });
  const [signupUsername, setSignupUsername] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [username, setUsername] = useState('');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const remoteDataLoaded = useRef(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Streak state ──────────────────────────────────────────────────────────────
  const [globalStreak, setGlobalStreak] = useState(0);
  const [lastActivityDate, setLastActivityDate] = useState<string | null>(null);
  const [streakBroken, setStreakBroken] = useState(false);

  // ── Leaderboard consent ───────────────────────────────────────────────────────
  const [leaderboardConsent, setLeaderboardConsent] = useState<boolean | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'home'|'leaderboard'>('home');
  const [leaderboard, setLeaderboard] = useState<{rank:number;username:string;xp:number;streak:number;level:number}[]>([]);
  const [lbLoading, setLbLoading] = useState(false);
  const lbLastFetch = useRef<number>(0);
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // ── Derived ───────────────────────────────────────────────────────────────────
  const upcoming = useMemo(() => habits.filter((h) => !h.completed), [habits]);

  const categoryProgress = useMemo(
    () =>
      deedCategories.map((category) => {
        const relevantTitles = category.deeds.map((d) => d.label);
        const categoryHabits = habits.filter((h) => relevantTitles.includes(h.title));
        const completed = categoryHabits.filter((h) => h.completed).length;
        return {
          ...category,
          completed,
          total: categoryHabits.length,
          emoji: category.deeds[0]?.emoji ?? '🌿',
        };
      }),
    [habits, deedCategories],
  );

  const treeCompletion = useMemo(() => {
    if (categoryProgress.length === 0) return 0;
    const score = categoryProgress.reduce(
      (sum, cat) => sum + (cat.total ? cat.completed / cat.total : 0),
      0,
    );
    return score / categoryProgress.length;
  }, [categoryProgress]);

  const treeStages = ['Seedling', 'Growing Sapling', 'Branching Out', 'Leafy Grove', 'Eco Oak'];
  const treeStage = treeStages[Math.min(treeStages.length - 1, Math.floor(treeCompletion * treeStages.length))];

  const calcLevel = (totalXp: number) => { let lvl = 1, acc = 0; while (true) { const n = 100+(lvl-1)*20; if (totalXp<acc+n) return { lvl, progress: totalXp-acc, required: n }; acc+=n; lvl++; } return { lvl: 1, progress: 0, required: 100 }; };
  const { lvl: level, progress, required } = calcLevel(xp);
  const percentage = Math.floor((progress / required) * 100);

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const formatDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const todayStr = () => formatDateStr(new Date());

  const yesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return formatDateStr(d);
  };

  // Returns both today and yesterday from the same moment to avoid midnight race
  const todayAndYesterday = () => {
    const d = new Date();
    const today = formatDateStr(d);
    d.setDate(d.getDate() - 1);
    const yesterday = formatDateStr(d);
    return { today, yesterday };
  };

  const fmtTime = (d: Date, tz: string) =>
    new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz,
    }).format(d);

  const parseTimeToNextDate = (timeWithAmpm: string, dateStr?: string) => {
    const m = timeWithAmpm.trim().match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])/);
    if (!m) return null;
    let hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();
    if (ap === 'AM') { if (hh === 12) hh = 0; } else { if (hh !== 12) hh += 12; }
    if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, mo, d] = dateStr.split('-').map((x) => parseInt(x, 10));
      return new Date(y, mo - 1, d, hh, mm, 0);
    }
    const nowDate = new Date();
    const target = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), hh, mm, 0);
    if (target.getTime() <= nowDate.getTime()) target.setDate(target.getDate() + 1);
    return target;
  };

  const computeNextDateString = (timeOnly: string) => {
    const next = parseTimeToNextDate(timeOnly);
    if (!next) return '';
    return `${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
  };

  // ── Effects ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-reset completed habits each new day + check streak break
  useEffect(() => {
    const { today, yesterday } = todayAndYesterday();
    setHabits((prev) =>
      prev.map((h) =>
        h.completed && h.lastCompletedDate !== today
          ? { ...h, completed: false }
          : h,
      ),
    );
    // Break streak if last activity wasn't yesterday or today
    setGlobalStreak((prev) => {
      if (prev > 0 && lastActivityDate && lastActivityDate < yesterday) {
        setStreakBroken(true);
        AsyncStorage.setItem('eco_global_streak', '0').catch(() => {});
        return 0;
      }
      return prev;
    });
  }, [now.toDateString()]);

  useEffect(() => {
    (async () => {
      try {
        const [habitsStr, xpStr, notifStr, storedCreds, streakStr, lastDateStr, customDeedsStr, carbonStr] =
          await Promise.all([
            AsyncStorage.getItem('eco_habits'),
            AsyncStorage.getItem('eco_xp'),
            AsyncStorage.getItem('eco_notifs'),
            AsyncStorage.getItem('eco_user_credentials'),
            AsyncStorage.getItem('eco_global_streak'),
            AsyncStorage.getItem('eco_last_activity_date'),
            AsyncStorage.getItem('eco_custom_deeds'),
            AsyncStorage.getItem('eco_lifetime_carbon'),
          ]);

        if (habitsStr) setHabits(JSON.parse(habitsStr));
        if (xpStr) setXp(parseInt(xpStr, 10));
        if (carbonStr) setLifetimeCarbonKg(parseFloat(carbonStr) || 0);
        if (customDeedsStr) { try { setCustomDeeds(JSON.parse(customDeedsStr)); } catch {} }
        if (notifStr) { try { setNotifMap(JSON.parse(notifStr)); } catch {} }
        if (storedCreds) {
          try {
            const creds = JSON.parse(storedCreds) as Credentials;
            setLogin({ email: creds.email, password: '' });
          } catch {}
        }
        const storedUsername = await AsyncStorage.getItem('eco_username');
        if (storedUsername) setUsername(storedUsername);

        // Global streak — check for break on load
        const savedStreak = streakStr ? parseInt(streakStr, 10) : 0;
        const savedLastDate = lastDateStr && lastDateStr.length > 0 ? lastDateStr : null;
        setLastActivityDate(savedLastDate);

        if (savedStreak > 0 && savedLastDate) {
          const { today, yesterday } = todayAndYesterday();
          if (savedLastDate < yesterday) {
            // Missed a day — streak broken
            setGlobalStreak(0);
            setStreakBroken(true);
            await AsyncStorage.setItem('eco_global_streak', '0');
          } else {
            setGlobalStreak(savedStreak);
            // Reset broken flag if they completed something today already
            if (savedLastDate === today) setStreakBroken(false);
          }
        } else {
          setGlobalStreak(savedStreak);
        }
      } catch (err) {
        console.log('Failed to load from AsyncStorage', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!loggedIn) return; // don't overwrite cached data when logged out
    (async () => {
      try {
        await Promise.all([
          AsyncStorage.setItem('eco_habits', JSON.stringify(habits)),
          AsyncStorage.setItem('eco_xp', String(xp)),
          AsyncStorage.setItem('eco_notifs', JSON.stringify(notifMap)),
          AsyncStorage.setItem('eco_global_streak', String(globalStreak)),
          AsyncStorage.setItem('eco_last_activity_date', lastActivityDate ?? ''),
          AsyncStorage.setItem('eco_custom_deeds', JSON.stringify(customDeeds)),
          AsyncStorage.setItem('eco_lifetime_carbon', String(lifetimeCarbonKg)),
        ]);
      } catch (err) {
        console.log('Failed to save to AsyncStorage', err);
      }
    })();
  }, [habits, xp, notifMap, globalStreak, lastActivityDate, loggedIn, lifetimeCarbonKg]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        remoteDataLoaded.current = false; // reset so saves don't fire before load completes
        setFirebaseUser(user);
        setLoggedIn(true);
        // Single Firestore read — handles username, consent, and all user data
        await loadRemoteUserData(user.uid);
      } else {
        setFirebaseUser(null);
        setLoggedIn(false);
      }
      setAuthLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    if (!remoteDataLoaded.current) return;
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      saveRemoteUserData(firebaseUser.uid);
    }, 2000);
  }, [habits, xp, globalStreak, lastActivityDate, firebaseUser, customDeeds, lifetimeCarbonKg]);

  // Force-refresh leaderboard every time the user opens that tab so streak is always current
  useEffect(() => {
    if (activeTab === 'leaderboard') fetchLeaderboard(true, username, xp, globalStreak);
  }, [activeTab]);

  useEffect(() => {
    if (!Notifications) return;
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
      } catch {}
    })();
  }, []);

  // ── Firebase ──────────────────────────────────────────────────────────────────

  const loadRemoteUserData = async (uid: string) => {
    try {
      const userDoc = doc(db, 'eco_users', uid);
      const snapshot = await getDoc(userDoc);
      if (snapshot.exists()) {
        const remote = snapshot.data() as {
          habits?: Habit[];
          xp?: number;
          globalStreak?: number;
          lastActivityDate?: string;
          customDeeds?: Array<{ id: string; label: string; emoji: string }>;
          lifetimeCarbonKg?: number;
          username?: string;
          leaderboardConsent?: boolean;
        };
        if (remote.habits) setHabits(remote.habits);
        if (typeof remote.xp === 'number') setXp(remote.xp);
        if (typeof remote.globalStreak === 'number') setGlobalStreak(remote.globalStreak);
        if (remote.lastActivityDate) setLastActivityDate(remote.lastActivityDate);
        if (remote.customDeeds) setCustomDeeds(remote.customDeeds);
        if (typeof remote.lifetimeCarbonKg === 'number') setLifetimeCarbonKg(remote.lifetimeCarbonKg);
        if (remote.username) {
          setUsername(remote.username);
          await AsyncStorage.setItem('eco_username', remote.username);
        }
        if (typeof remote.leaderboardConsent === 'boolean') {
          setLeaderboardConsent(remote.leaderboardConsent);
        } else {
          setLeaderboardConsent(null);
        }
        // Reschedule notifications for incomplete habits
        if (Notifications && remote.habits) {
          remote.habits.filter(h => !h.completed).forEach(h => {
            const timeOnly = h.time.replace(/^\d{2}-\d{2}\s+/, '');
            scheduleForHabit(h.id, h.title, timeOnly).catch(() => {});
          });
        }
      } else {
        // New user — create a fresh doc
        await setDoc(userDoc, { habits: [], xp: 0, globalStreak: 0, lastActivityDate: null, customDeeds: [], lifetimeCarbonKg: 0 });
        setLeaderboardConsent(null);
      }
      remoteDataLoaded.current = true;
    } catch (err) {
      console.log('Failed to load remote user data', err);
      remoteDataLoaded.current = true; // allow saves even if load failed
    }
  };

  const saveRemoteUserData = async (uid: string) => {
    try {
      const userDoc = doc(db, 'eco_users', uid);
      // Always save xp and globalStreak — only expose to leaderboard if consented
      const leaderboardFields = leaderboardConsent ? { username, globalStreak, xp } : { xp, globalStreak };
      await setDoc(userDoc, { habits, lastActivityDate, customDeeds, lifetimeCarbonKg, ...leaderboardFields }, { merge: true });
    } catch (err) {
      console.log('Failed to save remote user data', err);
    }
  };

  // ── Notifications ─────────────────────────────────────────────────────────────

  const scheduleForHabit = async (id: string, title: string, timeWithAmpm: string, dateStr?: string) => {
    if (!Notifications) return;
    const when = parseTimeToNextDate(timeWithAmpm, dateStr);
    if (!when) return;
    try {
      const identifier = await Notifications.scheduleNotificationAsync({
        content: { title: 'Eco Habit Reminder', body: title },
        trigger: when,
      } as any);
      setNotifMap((m) => ({ ...m, [id]: identifier }));
    } catch {}
  };

  const cancelForHabit = async (id: string) => {
    if (!Notifications) return;
    const ident = notifMap[id];
    if (!ident) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(ident);
      setNotifMap((m) => { const n = { ...m }; delete n[id]; return n; });
    } catch {}
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const add = () => {
    if (!selectedDeed) {
      alert('Please choose a deed from the list');
      return;
    }
    const whenOnly = `${time || '08:00'} ${ampm}`;
    const deedLabel = deeds.find((d) => d.id === selectedDeed)?.label ?? selectedDeed;
    const displayTime =
      date && /^\d{2}-\d{2}$/.test(date) ? `${date} ${whenOnly}` : whenOnly;
    const h: Habit = {
      id: `${Date.now()}-${selectedDeed}`,
      title: deedLabel.trim(),
      time: displayTime,
      completed: false,
      streak: 0,
      lastCompletedDate: null,
    };
    setHabits((s) => [h, ...s]);
    let fullDateForScheduler: string | undefined;
    if (date && /^\d{2}-\d{2}$/.test(date)) {
      const nowD = new Date();
      const [mm, dd] = date.split('-').map((x) => parseInt(x, 10));
      fullDateForScheduler = `${nowD.getFullYear()}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    }
    scheduleForHabit(h.id, h.title, whenOnly, fullDateForScheduler);
    setTime('08:00');
    setAmpm('AM');
    setDate('');
    setSelectedDeed(null);
  };

  const toggle = (id: string) => {
    const h = habits.find((x) => x.id === id);
    if (!h) return;
    const willComplete = !h.completed;

    if (willComplete) {
      cancelForHabit(id);
      setXp((v) => Math.max(0, v + XP_PER));
      // Accumulate lifetime carbon
      const allDeeds = DEFAULT_DEED_CATEGORIES.flatMap(c => c.deeds);
      const deed = allDeeds.find(d => d.label === h.title);
      const carbonKg = deed ? (CO2_SAVINGS_G[deed.id] ?? 300) / 1000 : 0;
      if (carbonKg > 0) setLifetimeCarbonKg(prev => prev + carbonKg);
      if (Platform.OS === 'web') {
        fireWebConfetti();
      } else {
        confettiRef.current?.start();
      }

      // Per-habit streak — only increment once per day
      const { today, yesterday: yest } = todayAndYesterday();
      const newHabitStreak =
        h.lastCompletedDate === today
          ? (h.streak || 0) // already completed today, don't increment again
          : h.lastCompletedDate === yest
            ? (h.streak || 0) + 1
            : 1;

      setHabits((prev) =>
        prev.map((hh) =>
          hh.id === id
            ? { ...hh, completed: true, streak: newHabitStreak, lastCompletedDate: today }
            : hh,
        ),
      );

      // Global daily streak
      if (lastActivityDate !== today) {
        const newGlobal = lastActivityDate === yest ? globalStreak + 1 : 1;
        const newXp = xp + XP_PER; // XP_PER already added via setXp above
        setGlobalStreak(newGlobal);
        setLastActivityDate(today);
        setStreakBroken(false);
        // Save immediately so leaderboard is always up to date — fix 1: use computed newXp
        if (firebaseUser) {
          const userDoc = doc(db, 'eco_users', firebaseUser.uid);
          const lbFields = leaderboardConsent ? { username, globalStreak: newGlobal, xp: newXp } : { globalStreak: newGlobal };
          setDoc(userDoc, { lastActivityDate: today, ...lbFields }, { merge: true }).catch(() => {});
        }
      }
    } else {
      // Strip date prefix (e.g. "06-21 08:00 AM" → "08:00 AM") before rescheduling
      const timeOnly = h.time.replace(/^\d{2}-\d{2}\s+/, '');
      scheduleForHabit(id, h.title, timeOnly);
      setHabits((prev) =>
        prev.map((hh) =>
          hh.id === id
            ? { ...hh, completed: false }
            : hh,
        ),
      );
    }
  };

  const remove = (id: string) => {
    cancelForHabit(id);
    setHabits((s) => s.filter((h) => h.id !== id));
  };

  const clearCompleted = () => {
    setHabits((s) => s.map((h) => h.completed ? { ...h, completed: false } : h));
  };

  const handleLogin = async () => {
    const email    = login.email.trim().toLowerCase();
    const password = login.password;
    if (!email || !password) { alert('Enter your email and password'); return; }
    if (!EMAIL_PATTERN.test(email)) { alert('Enter a valid email address'); return; }

    if (isSignup) {
      const uname = signupUsername.trim().toLowerCase();
      if (!uname) { alert('Pick a username'); return; }
      if (!/^[a-z0-9_]{3,20}$/.test(uname)) { alert('Username: 3–20 chars, letters/numbers/underscore'); return; }
      if (password.length < 6) { alert('Password must be at least 6 characters'); return; }
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid  = cred.user.uid;
        await AsyncStorage.setItem('eco_user_credentials', JSON.stringify({ email }));
        await AsyncStorage.setItem('eco_username', uname);
        // Save username to Firestore immediately on signup
        await setDoc(doc(db, 'eco_users', uid), { username: uname, habits: [], xp: 0, globalStreak: 0, lastActivityDate: null, lifetimeCarbonKg: 0, customDeeds: [] }, { merge: true });
        setUsername(uname); setLogin({ email, password: '' });
        // onAuthStateChanged will fire and handle the rest
      } catch (e: any) {
        if (e.code === 'auth/email-already-in-use') alert('That email already has an account. Try logging in.');
        else alert('Could not create account. Please try again.');
      }
    } else {
      try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        await AsyncStorage.setItem('eco_user_credentials', JSON.stringify({ email }));
        setLogin({ email, password: '' });
        // onAuthStateChanged will fire and call loadRemoteUserData — no need to call it here
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

  const fetchLeaderboard = async (force = false, currentUsername = username, currentXp = xp, currentStreak = globalStreak) => {
    setLbLoading(true);
    try {
      const snap = await getDocsFromServer(collection(db, 'eco_users'));
      const seen = new Set<string>();
      let users = snap.docs
        .map(d => {
          const data = d.data() as any;
          const totalXp = data.xp || 0;
          let lvl = 1, acc = 0;
          while (true) { const n = 100+(lvl-1)*20; if (totalXp<acc+n) break; acc+=n; lvl++; }
          return { username: data.username || '', xp: totalXp, streak: data.globalStreak||0, level: lvl };
        })
        .filter(u => {
          if (!u.username) return false;
          if (seen.has(u.username)) return false;
          seen.add(u.username);
          return true;
        });
      // Always use fresh local state for current user
      if (currentUsername) {
        users = users.map(u => {
          if (u.username !== currentUsername) return u;
          let lvl = 1, acc = 0;
          while (true) { const n = 100+(lvl-1)*20; if (currentXp<acc+n) break; acc+=n; lvl++; }
          return { ...u, xp: currentXp, streak: currentStreak, level: lvl };
        });
      }
      const ranked = users
        .sort((a,b) => b.xp - a.xp)
        .slice(0, 50)
        .map((u, i) => ({ ...u, rank: i+1 }));
      setLeaderboard(ranked);
    } catch {}
    setLbLoading(false);
  };


  const resetLocalState = () => {
    setHabits([]);
    setXp(0);
    setLifetimeCarbonKg(0);
    setGlobalStreak(0);
    setLastActivityDate(null);
    setStreakBroken(false);
    setCustomDeeds([]);
    setNotifMap({});
    setLeaderboard([]);
    setUsername('');
    setLogin({ email: '', password: '' });
    setIsSignup(false);
    setSignupUsername('');
    setLoggedIn(false);
    setFirebaseUser(null);
    setActiveTab('home');
    setLeaderboardConsent(null);
    remoteDataLoaded.current = false;
  };

  const handleLogout = async () => {
    try { await signOut(auth); } catch {}
    AsyncStorage.multiRemove([
      'eco_user_credentials', 'eco_username', 'eco_habits', 'eco_xp',
      'eco_global_streak', 'eco_last_activity_date', 'eco_custom_deeds',
      'eco_lifetime_carbon', 'eco_notifs',
    ]).catch(() => {});
    resetLocalState();
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'This will permanently delete your account and all your eco data (habits, streak, XP). This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            try {
              if (firebaseUser) {
                await deleteDoc(doc(db, 'eco_users', firebaseUser.uid));
                await deleteUser(firebaseUser);
              }
            } catch (e: any) {
              if (e?.code === 'auth/requires-recent-login') {
                Alert.alert('Session Expired', 'Please sign out and sign back in, then try deleting your account again.');
                return;
              }
            }
            await AsyncStorage.multiRemove([
              'eco_user_credentials', 'eco_username', 'eco_habits', 'eco_xp',
              'eco_global_streak', 'eco_last_activity_date', 'eco_custom_deeds',
              'eco_lifetime_carbon', 'eco_notifs',
            ]);
            resetLocalState();
            Alert.alert('Account Deleted', 'Your account and all your data have been permanently deleted.');
          },
        },
      ]
    );
  };

  // ── Auth Loading Screen ───────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#022c22','#064e3b','#065f46']} style={[styles.gradient, {alignItems:'center',justifyContent:'center'}]} start={[0,0]} end={[1,1]}>
          <StatusBar style="light" />
          <Text style={{fontSize:64}}>🌿</Text>
          <Text style={{color:'#4ade80',fontSize:22,fontWeight:'900',marginTop:12}}>Eco Habit</Text>
          <Text style={{color:'#86efac',fontSize:14,marginTop:8}}>Loading...</Text>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // ── Login Screen ──────────────────────────────────────────────────────────────

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#022c22','#064e3b','#065f46']} style={styles.gradient} start={[0, 0]} end={[1, 1]}>
          <StatusBar style="light" />
          <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView contentContainerStyle={styles.loginContainer} keyboardShouldPersistTaps="handled">
            <EarthMascot />
            <Text style={styles.loginTitle}>🌿 Eco Habit</Text>
            <Text style={styles.loginNotice}>Small habits. Big impact. 🌍</Text>

            <View style={styles.loginCard}>
              <Text style={[styles.loginCardTitle, { fontSize: 20 }]}>Hey there! 👋</Text>
              <Text style={{ color: '#86efac', textAlign: 'center', fontSize: 13, marginBottom: 20 }}>
                New or returning — just fill in your details
              </Text>

              <Text style={{ color: '#86efac', fontSize: 13, fontWeight: '700', marginBottom: 6 }}>Your email address</Text>
              <TextInput
                style={styles.loginInput}
                placeholder="Your email"
                placeholderTextColor="rgba(110,231,183,0.6)"
                value={login.email}
                onChangeText={(v) => setLogin((p) => ({ ...p, email: v }))}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
              />

              <Text style={{ color: '#86efac', fontSize: 13, fontWeight: '700', marginBottom: 2 }}>Your Eco Habit password</Text>
              <Text style={{ color: 'rgba(110,231,183,0.6)', fontSize: 11, marginBottom: 6 }}>Not your Gmail password — create a new one just for this app</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(110,231,183,0.3)', borderRadius: 14, marginBottom: 16 }}>
                <TextInput
                  style={[styles.loginInput, { flex: 1, marginBottom: 0, borderWidth: 0, backgroundColor: 'transparent' }]}
                  placeholder="Your password"
                  placeholderTextColor="rgba(110,231,183,0.6)"
                  value={login.password}
                  onChangeText={(v) => setLogin((p) => ({ ...p, password: v }))}
                  secureTextEntry={!showPassword}
                  textContentType="password"
                />
                <TouchableOpacity onPress={() => setShowPassword(p => !p)} style={{ paddingHorizontal: 14 }}>
                  <Text style={{ fontSize: 18 }}>{showPassword ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={() => setIsSignup(p => !p)} style={{ marginBottom: 8 }}>
                <Text style={{ color: '#86efac', fontSize: 13, textAlign: 'center' }}>
                  {isSignup ? '▾ Already have an account? Hide this' : '▸ New here? Create your username'}
                </Text>
              </TouchableOpacity>
              {isSignup && (
                <>
                  <Text style={{ color: '#86efac', fontSize: 12, marginBottom: 6, opacity: 0.8 }}>👤 Pick a username — shown on leaderboard</Text>
                  <TextInput
                    style={styles.loginInput}
                    placeholder="e.g. greenplant42"
                    placeholderTextColor="rgba(110,231,183,0.6)"
                    value={signupUsername}
                    onChangeText={setSignupUsername}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              )}

              {forgotMode ? (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: 14, padding: 16, marginTop: 4 }}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16, marginBottom: 4, textAlign: 'center' }}>🔑 Reset Password</Text>
                  <Text style={{ color: '#86efac', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>Enter your email and we'll send a reset link</Text>
                  <TextInput
                    style={styles.loginInput}
                    placeholder="your@email.com"
                    placeholderTextColor="rgba(110,231,183,0.6)"
                    value={forgotEmail} onChangeText={setForgotEmail}
                    autoCapitalize="none" keyboardType="email-address"
                  />

                  {forgotSent
                    ? <>
                        <Text style={{ color: '#4ade80', textAlign: 'center', fontWeight: '700', fontSize: 14, marginBottom: 4 }}>✅ Reset link sent!</Text>
                        <Text style={{ color: '#86efac', textAlign: 'center', fontSize: 12, marginBottom: 8 }}>Can't find it? Check your spam or junk folder 📂</Text>
                      </>
                    : <>
                        <TouchableOpacity style={styles.loginButton} onPress={handleForgotPassword}>
                          <Text style={styles.loginButtonText}>Send Reset Link 📧</Text>
                        </TouchableOpacity>
                        <Text style={{ color: 'rgba(110,231,183,0.6)', fontSize: 11, textAlign: 'center', marginTop: 6 }}>📂 Email may land in your spam or junk folder</Text>
                      </>
                  }
                  <TouchableOpacity onPress={resetRecovery} style={{ alignSelf: 'center', padding: 8, marginTop: 8 }}>
                    <Text style={{ color: '#86efac', fontSize: 13 }}>← Back to login</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <TouchableOpacity style={styles.loginButton} onPress={handleLogin} accessibilityRole="button">
                    <Text style={styles.loginButtonText}>Let's Go! 🌿</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setForgotMode(true)} style={{ alignSelf: 'center', marginTop: 12, padding: 8 }}>
                    <Text style={{ color: '#86efac', fontSize: 13 }}>Forgot password?</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </ScrollView>
          </KeyboardAvoidingView>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // ── Leaderboard Consent Screen ────────────────────────────────────────────────

  if (leaderboardConsent === null) {
    const giveConsent = async (agreed: boolean) => {
      setLeaderboardConsent(agreed);
      if (firebaseUser) {
        setDoc(doc(db, 'eco_users', firebaseUser.uid), { leaderboardConsent: agreed }, { merge: true }).catch(() => {});
      }
    };
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#011a12','#022c22','#064e3b']} style={[styles.gradient,{justifyContent:'center',alignItems:'center',padding:32}]} start={[0,0]} end={[1,1]}>
          <Text style={{fontSize:48,marginBottom:16}}>🏆</Text>
          <Text style={{color:'#4ade80',fontSize:22,fontWeight:'900',textAlign:'center',marginBottom:12}}>Join the Leaderboard?</Text>
          <Text style={{color:'#d1fae5',fontSize:15,textAlign:'center',marginBottom:8,lineHeight:22}}>
            Eco Habit has a global leaderboard that shows your <Text style={{fontWeight:'800'}}>username</Text>, <Text style={{fontWeight:'800'}}>streak</Text>, <Text style={{fontWeight:'800'}}>XP</Text> and <Text style={{fontWeight:'800'}}>level</Text> to other users.
          </Text>
          <Text style={{color:'#86efac',fontSize:13,textAlign:'center',marginBottom:32,lineHeight:20}}>
            Your email is never shared. You can change this in settings anytime.
          </Text>
          <TouchableOpacity onPress={() => giveConsent(true)} style={{backgroundColor:'#22c55e',borderRadius:16,paddingVertical:14,paddingHorizontal:40,marginBottom:12,width:'100%',alignItems:'center'}}>
            <Text style={{color:'#fff',fontWeight:'900',fontSize:16}}>✅ Yes, show me on leaderboard</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => giveConsent(false)} style={{backgroundColor:'#374151',borderRadius:16,paddingVertical:14,paddingHorizontal:40,width:'100%',alignItems:'center'}}>
            <Text style={{color:'#d1d5db',fontWeight:'700',fontSize:15}}>No thanks, keep me private</Text>
          </TouchableOpacity>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // ── Main Screen ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Leaderboard screen */}
      {activeTab === 'leaderboard' && (
        <View style={{ flex: 1 }}>
          <LinearGradient colors={['#011a12','#022c22','#064e3b']} style={{ paddingTop: 18, paddingBottom: 20, paddingHorizontal: 20 }} start={[0,0]} end={[1,1]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <TouchableOpacity onPress={() => setActiveTab('home')} style={{ backgroundColor: '#1e5c3e', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6 }}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>← Back</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '900', color: '#fff' }}>🏆 Leaderboard</Text>
              <TouchableOpacity onPress={() => fetchLeaderboard(true, username, xp, globalStreak)} style={{ backgroundColor: '#1e5c3e', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={{ color: '#4ade80', fontWeight: '700', fontSize: 12 }}>↻ Refresh</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#6ee7b7', fontSize: 12, textAlign: 'center', marginTop: 6 }}>Top Eco Warriors worldwide</Text>
          </LinearGradient>
          <ScrollView style={{ flex: 1, backgroundColor: '#f9fafb' }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {lbLoading && <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40, fontSize: 15 }}>Loading...</Text>}
            {!lbLoading && leaderboard.length === 0 && <Text style={{ color: '#9ca3af', textAlign: 'center', marginTop: 40, fontSize: 15 }}>No data yet. Be the first! 🌱</Text>}
            {leaderboard.map((u, i) => {
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
              const isMe  = u.username === username;
              return (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isMe ? '#dcfce7' : '#fff', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: isMe ? 2 : 1, borderColor: isMe ? '#22c55e' : '#e5e7eb' }}>
                  <Text style={{ fontSize: 20, width: 40, textAlign: 'center', fontWeight: '900' }}>{medal}</Text>
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={{ fontWeight: '800', fontSize: 15, color: '#111827' }}>{u.username}{isMe ? ' (you)' : ''}</Text>
                    <Text style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>Level {u.level} · 🔥 {u.streak} day streak</Text>
                  </View>
                  <Text style={{ fontWeight: '900', fontSize: 16, color: '#059669' }}>{u.xp} XP</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {activeTab === 'home' && <ScrollView style={{ flex: 1 }}>

        {/* ── Hero Header ── */}
        <LinearGradient colors={['#011a12', '#022c22', '#064e3b']} style={styles.hero} start={[0, 0]} end={[1, 1]}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLogo}>🌿 Eco Habit</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={() => { setActiveTab('leaderboard'); fetchLeaderboard(true, username, xp, globalStreak); }} style={{ backgroundColor: '#6366f1', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 }}>
                <Text style={styles.heroSignOutTxt}>🏆 Leaderboard</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleLogout} style={styles.heroSignOut}>
                <Text style={styles.heroSignOutTxt}>Sign out</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={styles.heroTagline}>
            {username || 'Eco Warrior'} · {globalStreak > 0 ? `🌱 ${globalStreak}-day streak!` : '🌱 Start your journey!'}
          </Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>⭐ {level}</Text>
              <Text style={styles.heroStatLbl}>Level</Text>
            </View>
            <View style={styles.heroStatDiv} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>🔥 {globalStreak}</Text>
              <Text style={styles.heroStatLbl}>Streak</Text>
            </View>
            <View style={styles.heroStatDiv} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatVal}>{xp}</Text>
              <Text style={styles.heroStatLbl}>XP</Text>
            </View>
          </View>
          <View style={styles.heroXpBg}>
            <View style={[styles.heroXpFill, { width: `${percentage}%` as any }]} />
          </View>
          <Text style={styles.heroXpTxt}>{progress}/{required} XP to Level {level + 1}</Text>
        </LinearGradient>

        <LinearGradient colors={['#f3e8ff', '#e0f2fe', '#dcfce7']} style={styles.content} start={[0, 0]} end={[1, 1]}>

          {/* ── Streak Tree Card ── */}
          <View style={[styles.card, { backgroundColor: '#f3e8ff' }]}>
            <View style={styles.cardHeader}>
              <Text style={styles.section}>🔥 Streak Tree</Text>
              <View style={[styles.streakPill, globalStreak > 0 ? styles.streakPillActive : styles.streakPillEmpty]}>
                <Text style={[styles.streakPillText, globalStreak > 0 ? styles.streakPillTextActive : styles.streakPillTextEmpty]}>
                  {globalStreak > 0 ? `${globalStreak} days strong` : 'No streak yet'}
                </Text>
              </View>
            </View>
            <Text style={styles.cardSubtitle}>
              Complete at least one habit daily to grow your tree. Miss a day and it gets chopped! 🪓
            </Text>
            <StreakTree streak={globalStreak} broken={streakBroken} />
            {/* Streak progress dots (up to 7 days shown) */}
            <View style={streakDotStyles.row}>
              {Array.from({ length: 7 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    streakDotStyles.dot,
                    globalStreak > 0 && (globalStreak % 7 === 0 ? true : i < globalStreak % 7)
                      ? streakDotStyles.dotFilled
                      : streakDotStyles.dotEmpty,
                  ]}
                />
              ))}
            </View>
            <Text style={streakDotStyles.label}>
              {globalStreak === 0
                ? 'Start your streak today!'
                : `${globalStreak} day${globalStreak !== 1 ? 's' : ''} strong · keep it up!`}
            </Text>
          </View>

          {/* ── Carbon Impact ── */}
          {(() => {
            const totalKg = lifetimeCarbonKg;
            const badge   = totalKg === 0 ? 'Keep going! 💪' : totalKg < 2 ? 'Nice start! 🌱' : totalKg < 10 ? 'Eco Hero! 🌿' : totalKg < 30 ? 'Super Green! 🌳' : 'Earth Champion! 🌍';
            return (
              <View style={[styles.card, { backgroundColor: '#ecfdf5', borderWidth: 2, borderColor: '#6ee7b7' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <Text style={styles.section}>🌍 Planet Impact</Text>
                  <View style={{ backgroundColor: '#059669', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{badge}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 28, fontWeight: '900', color: '#059669', textAlign: 'center' }}>{totalKg.toFixed(2)} kg CO₂</Text>
                <Text style={{ fontSize: 13, color: '#047857', textAlign: 'center', marginBottom: 8 }}>saved lifetime 🌱</Text>
                {totalKg === 0 && <Text style={{ color: '#9ca3af', textAlign: 'center', fontStyle: 'italic', fontSize: 12 }}>Complete habits to see your impact!</Text>}
              </View>
            );
          })()}

          {/* ── Eco Tree Progress Card ── */}
          <View style={[styles.card, { backgroundColor: '#e0f2fe' }]}>
            <Text style={styles.section}>📊 Dashboard</Text>
            <Text style={styles.cardSubtitle}>Complete reminders in each category to grow each branch.</Text>
            <View style={styles.treeContainer}>
              {categoryProgress.map((category, index) => {
                const completionRatio = category.total
                  ? Math.round((category.completed / category.total) * 100)
                  : 0;
                const completedAll = category.total > 0 && category.completed === category.total;
                return (
                  <View key={category.id} style={styles.treeRow}>
                    <View style={styles.treeMarkerColumn}>
                      <View style={[styles.treeNode, completedAll ? styles.treeNodeActive : styles.treeNodeInactive]}>
                        <Text style={styles.treeNodeEmoji}>{category.emoji}</Text>
                      </View>
                      {index !== categoryProgress.length - 1 && <View style={styles.treeConnector} />}
                    </View>
                    <View style={styles.treeMeta}>
                      <Text style={styles.treeNodeTitle}>{category.name}</Text>
                      <Text style={styles.treeNodeMeta}>
                        {category.total
                          ? `${category.completed}/${category.total} reminders`
                          : 'No reminders yet'}
                      </Text>
                      {category.total > 0 && (
                        <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2, fontWeight: '600' }}>
                          {category.completed === 0 ? 'Not started 🌱' : category.completed < category.total ? 'In progress 🌿' : 'Complete! 🎉'}
                        </Text>
                      )}
                      <View style={styles.treeProgressBar}>
                        <View style={[styles.treeProgressFill, { width: `${completionRatio}%` }]} />
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
            <Text style={styles.treeStatus}>Tree stage: {treeStage}</Text>
          </View>



          {/* ── Add Reminder ── */}
          <View style={[styles.card, { backgroundColor: '#dcfce7' }]}>
            <Text style={styles.section}>Add reminder</Text>
            {deedCategories.map((category) => (
              <View key={category.id} style={{ marginBottom: 12 }}>
                <Text style={styles.categoryHeader}>{category.name}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {category.deeds.map((d) => {
                    const active = selectedDeed === d.id;
                    return (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.deedItem, active && styles.deedItemActive]}
                        onPress={() => setSelectedDeed(d.id)}
                      >
                        <Text style={styles.deedEmoji}>{d.emoji}</Text>
                        <Text style={[styles.deedLabel, active && { color: '#e0e7ff' }]}>{d.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            {/* ── My Custom Deeds ── */}
            <View style={{ marginBottom: 12 }}>
              <Text style={styles.categoryHeader}>My Custom Deeds</Text>
              {customDeeds.length === 0 && (
                <Text style={{ color: '#9ca3af', fontSize: 12, marginBottom: 8, fontStyle: 'italic' }}>
                  No custom deeds yet — add one below!
                </Text>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {customDeeds.map((d) => {
                  const active = selectedDeed === d.id;
                  return (
                    <View
                      key={d.id}
                      style={[
                        styles.deedItem,
                        active && styles.deedItemActive,
                        { flexDirection: 'row', alignItems: 'center', marginRight: 8, marginBottom: 8 },
                      ]}
                    >
                      <TouchableOpacity
                        style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                        onPress={() => setSelectedDeed(d.id)}
                      >
                        <Text style={styles.deedEmoji}>{d.emoji}</Text>
                        <Text style={[styles.deedLabel, active && { color: '#e0e7ff' }]}>{d.label}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          if (selectedDeed === d.id) setSelectedDeed(null);
                          setCustomDeeds((prev) => prev.filter((x) => x.id !== d.id));
                        }}
                        style={{ marginLeft: 6, paddingHorizontal: 4 }}
                      >
                        <Text style={{ color: active ? '#fff' : '#ef4444', fontWeight: '800', fontSize: 13 }}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Add custom deed inline */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 6 }]}
                placeholder="🌿 Emoji"
                value={newDeedEmoji}
                onChangeText={setNewDeedEmoji}
              />
              <TextInput
                style={[styles.input, { flex: 3, marginRight: 6 }]}
                placeholder="Add your own deed..."
                value={newDeedLabel}
                onChangeText={setNewDeedLabel}
              />
              <TouchableOpacity
                style={[styles.addButton, { paddingHorizontal: 10 }]}
                onPress={() => {
                  if (!newDeedLabel.trim()) { alert('Enter a deed name'); return; }
                  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                  const newDeed = { id, label: newDeedLabel.trim(), emoji: newDeedEmoji || '✅' };
                  setCustomDeeds((d) => {
                    const updated = [...d, newDeed];
                    // Save immediately to Firestore
                    if (firebaseUser) {
                      setDoc(doc(db, 'eco_users', firebaseUser.uid), { customDeeds: updated }, { merge: true }).catch(() => {});
                    }
                    return updated;
                  });
                  setSelectedDeed(id);
                  setNewDeedLabel('');
                  setNewDeedEmoji('');
                }}
              >
                <Text style={styles.addButtonText}>+ Add</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ color: '#547a56', marginBottom: 8 }}>Choose one deed above; no custom text required.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 8 }]}
                placeholder="Time (HH:MM)"
                value={time}
                onChangeText={setTime}
                onSubmitEditing={add}
                keyboardType="numbers-and-punctuation"
              />
              <TextInput
                style={[styles.input, { width: 90, marginRight: 8 }]}
                placeholder="MM-DD"
                value={date}
                onChangeText={setDate}
                keyboardType="numbers-and-punctuation"
              />
              <TouchableOpacity
                style={styles.autoButton}
                onPress={() => {
                  const whenOnly = `${time || '08:00'} ${ampm}`;
                  const nextDate = computeNextDateString(whenOnly);
                  if (!nextDate) { alert('Unable to compute next date — check time format.'); return; }
                  setDate(nextDate);
                }}
              >
                <Text style={styles.autoText}>Auto</Text>
              </TouchableOpacity>
              <View style={styles.ampmRow}>
                {(['AM', 'PM'] as const).map((ap) => (
                  <TouchableOpacity
                    key={ap}
                    style={[styles.ampmButton, ampm === ap && styles.ampmActive]}
                    onPress={() => setAmpm(ap)}
                  >
                    <Text style={[styles.ampmText, ampm === ap && styles.ampmTextActive]}>{ap}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity style={styles.addButton} onPress={add} accessibilityRole="button">
              <Text style={styles.addButtonText}>Add</Text>
            </TouchableOpacity>
          </View>

          {/* ── Upcoming ── */}
          <View style={[styles.card, { backgroundColor: '#fce7f3' }]}>
            <Text style={styles.section}>Upcoming</Text>
            {upcoming.length === 0 ? (
              <Text style={styles.empty}>No upcoming reminders</Text>
            ) : (
              <FlatList
                data={upcoming}
                keyExtractor={(i) => i.id}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View style={styles.row}>
                    <View style={styles.rowText}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text style={styles.title}>{item.title}</Text>
                        {(item.streak ?? 0) > 0 && (
                          <View style={styles.streakBadge}>
                            <Text style={styles.streakText}>🔥 {item.streak}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.meta}>⏱ {item.time}</Text>
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.smallButton} onPress={() => toggle(item.id)}>
                        <Text style={styles.smallText}>Done ✓</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.smallButton, styles.delete]} onPress={() => remove(item.id)}>
                        <Text style={styles.smallText}>✕</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
          </View>

          {/* ── Completed Today ── */}
          {habits.filter(h => h.completed).length > 0 && (
            <View style={[styles.card, { backgroundColor: '#dcfce7' }]}>
              <Text style={styles.section}>✅ Completed Today</Text>
              <FlatList
                data={habits.filter(h => h.completed)}
                keyExtractor={(i) => i.id}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View style={[styles.row, styles.rowDone]}>
                    <View style={styles.rowText}>
                      <Text style={[styles.title, styles.titleDone]}>{item.title}</Text>
                      {(item.streak ?? 0) > 0 && (
                        <View style={styles.streakBadge}>
                          <Text style={styles.streakText}>🔥 {item.streak}</Text>
                        </View>
                      )}
                    </View>
                    <TouchableOpacity style={[styles.smallButton, styles.smallButtonDone]} onPress={() => toggle(item.id)}>
                      <Text style={[styles.smallText, styles.smallTextDone]}>Undo</Text>
                    </TouchableOpacity>
                  </View>
                )}
              />
            </View>
          )}

          <View style={styles.footer}>
            <Button title="Clear completed" onPress={clearCompleted} />
            <Text style={styles.footerNote}>Made by Siddharth</Text>
          </View>

          {/* ── Account Deletion ── */}
          <View style={{ marginHorizontal: 16, marginBottom: 24, marginTop: 32, alignItems: 'flex-start' }}>
            <TouchableOpacity
              onPress={handleDeleteAccount}
              style={{ backgroundColor: '#7f1d1d', borderRadius: 14, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>🗑 Delete Account</Text>
              <Text style={{ color: '#fca5a5', fontSize: 12, marginTop: 4 }}>Permanently deletes all your data</Text>
            </TouchableOpacity>
          </View>

        </LinearGradient>{/* end content */}
      </ScrollView>}

      {Platform.OS !== 'web' && (
          <ConfettiCannon
            ref={confettiRef}
            count={120}
            origin={{ x: -10, y: 0 }}
            autoStart={false}
            fadeOut
            fallSpeed={2500}
            explosionSpeed={350}
            colors={['#4ade80', '#22c55e', '#16a34a', '#facc15', '#fb923c', '#60a5fa', '#f472b6']}
          />
        )}
    </SafeAreaView>
  );
}

// ─── Streak Dot Styles ────────────────────────────────────────────────────────

const streakDotStyles = StyleSheet.create({
  row:       { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot:       { width: 12, height: 12, borderRadius: 6 },
  dotFilled: { backgroundColor: '#10b981' },
  dotEmpty:  { backgroundColor: '#d1fae5', borderWidth: 1, borderColor: '#86efac' },
  label:     { textAlign: 'center', color: '#059669', fontWeight: '700', marginTop: 6, fontSize: 13 },
});

// ─── Main Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:  { flex: 1, backgroundColor: '#011a12' },
  gradient:  { flex: 1 },
  container: { padding: 16, paddingBottom: 48 },
  content:   { padding: 14, paddingBottom: 40 },

  // ── Hero ──
  hero: {
    paddingTop: 18, paddingBottom: 26, paddingHorizontal: 20,
    borderBottomLeftRadius: 28, borderBottomRightRadius: 28,
    marginBottom: 4,
  },
  heroTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  heroLogo:      { fontSize: 16, fontWeight: '900', color: '#ffffff' },
  heroSignOut:   { backgroundColor: '#f59e0b', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 0 },
  heroSignOutTxt:{ color: '#fff', fontWeight: '700', fontSize: 12 },
  heroTagline:   { color: '#6ee7b7', fontSize: 12, marginBottom: 14 },
  heroStats:     { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  heroStat:      { flex: 1, alignItems: 'center' },
  heroStatVal:   { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  heroStatLbl:   { color: '#4d9e7a', fontSize: 10, fontWeight: '600', marginTop: 2 },
  heroStatDiv:   { width: 1, height: 36, backgroundColor: '#1e5c3e' },
  heroXpBg:      { height: 12, backgroundColor: '#1a4a35', borderRadius: 8, overflow: 'hidden', marginBottom: 6 },
  heroXpFill:    { height: '100%', backgroundColor: '#38bdf8', borderRadius: 8 },
  heroXpTxt:     { color: '#4d9e7a', fontSize: 10, fontWeight: '600' },

  // ── Cards ──
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#059669',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    borderWidth: 2,
    borderColor: '#d1fae5',
  },
  cardHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  section:       { fontSize: 15, fontWeight: '800', color: '#064e3b' },
  cardSubtitle:  { color: '#547a56', fontSize: 13, marginBottom: 8, lineHeight: 18 },

  // ── Streak pill ──
  streakPill:          { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  streakPillActive:    { backgroundColor: '#dcfce7', borderColor: '#86efac' },
  streakPillEmpty:     { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' },
  streakPillText:      { fontSize: 12, fontWeight: '700' },
  streakPillTextActive:{ color: '#15803d' },
  streakPillTextEmpty: { color: '#9ca3af' },

  // ── Eco Tree ──
  treeContainer:    { marginTop: 8 },
  treeRow:          { flexDirection: 'row', marginBottom: 10 },
  treeMarkerColumn: { alignItems: 'center', width: 36 },
  treeNode:         { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  treeNodeActive:   { backgroundColor: '#10b981' },
  treeNodeInactive: { backgroundColor: '#e5e7eb' },
  treeNodeEmoji:    { fontSize: 16 },
  treeConnector:    { width: 2, flex: 1, backgroundColor: '#d1fae5', minHeight: 10 },
  treeMeta:         { flex: 1, paddingLeft: 12, justifyContent: 'center' },
  treeNodeTitle:    { fontWeight: '700', color: '#064e3b', fontSize: 14 },
  treeNodeMeta:     { color: '#6b7280', fontSize: 12, marginTop: 2 },
  treeProgressBar:  { height: 6, backgroundColor: '#d1fae5', borderRadius: 4, marginTop: 6, overflow: 'hidden' },
  treeProgressFill: { height: '100%', backgroundColor: '#10b981' },
  treeStatus:       { textAlign: 'center', color: '#059669', fontWeight: '700', marginTop: 10, fontSize: 13 },

  // ── Inputs ──
  input: { borderWidth: 1, borderColor: '#f3e8ff', borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: '#fffaf6' },

  // ── Upcoming list ──
  empty:         { color: '#9ca3af', textAlign: 'center', paddingVertical: 16 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8,
    backgroundColor: '#f0fdf4', borderRadius: 14,
    borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 4,
    borderTopColor: '#d1fae5', borderRightColor: '#d1fae5', borderBottomColor: '#d1fae5', borderLeftColor: '#10b981',
  },
  rowDone:       { borderLeftColor: '#d1d5db', borderTopColor: '#e5e7eb', borderRightColor: '#e5e7eb', borderBottomColor: '#e5e7eb', backgroundColor: '#f9fafb' },
  rowText:       { flex: 1, paddingRight: 8 },
  title:         { fontSize: 14, fontWeight: '700', color: '#064e3b' },
  titleDone:     { textDecorationLine: 'line-through', color: '#9ca3af' },
  meta:          { color: '#9ca3af', marginTop: 3, fontSize: 12 },
  actions:       { flexDirection: 'row', gap: 6 },
  smallButton:   { backgroundColor: '#10b981', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 20 },
  smallButtonDone:{ backgroundColor: '#f3f4f6' },
  smallText:     { color: '#fff', fontWeight: '700', fontSize: 12 },
  smallTextDone: { color: '#6b7280' },
  delete:        { backgroundColor: '#ff6b6b', borderWidth: 0 },
  streakBadge:   { marginLeft: 6, backgroundColor: '#fff3cd', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: '#ffc107' },
  streakText:    { fontSize: 11, fontWeight: '700', color: '#b45309' },

  footer:        { alignItems: 'center', marginTop: 10 },
  footerNote:    { color: '#a7f3d0', marginTop: 8, fontSize: 12 },

  // ── Login ──
  loginContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24, paddingBottom: 40 },
  loginTitle:     { fontSize: 28, fontWeight: '900', color: '#fff', marginTop: 10, letterSpacing: 0.5 },
  loginNotice:    { color: '#6ee7b7', marginBottom: 28, textAlign: 'center', fontSize: 14 },
  loginCard:      { width: '100%', maxWidth: 420, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(52,211,153,0.25)', padding: 24 },
  loginCardTitle: { fontSize: 18, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 20 },
  loginInput:     { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(110,231,183,0.3)', borderRadius: 14, padding: 14, color: '#fff', marginBottom: 12, fontSize: 15 },
  loginButton:    { backgroundColor: '#10b981', borderRadius: 14, paddingVertical: 15, alignItems: 'center', shadowColor: '#10b981', shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  loginButtonText:{ color: '#fff', fontWeight: '900', fontSize: 16 },

  // ── (kept for compat) ──
  header:        { marginBottom: 6 },
  userLabel:     { color: '#6b7280', fontWeight: '600', fontSize: 12 },
  logoutButton:  { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: '#fef2f2' },
  logoutText:    { color: '#ef4444', fontWeight: '700', fontSize: 12 },

  // ── World Clock ──
  worldRow:       { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 },
  worldItem:      { backgroundColor: '#f0f8ff', padding: 10, borderRadius: 12, marginBottom: 8 },
  worldLabel:     { color: '#1f6fbe', fontWeight: '700' },
  worldTime:      { color: '#059669', marginTop: 4, fontWeight: '800' },
  localHighlight: { borderWidth: 1, borderColor: '#10b981', backgroundColor: '#f0fdf4' },
  detectedBadge:  { backgroundColor: '#10b981', color: '#fff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontWeight: '700', fontSize: 11 },
  toggleButton:   { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#f59e0b', borderRadius: 8 },
  toggleText:     { color: '#fff', fontWeight: '700' },

  // ── Add reminder ──
  addButton:      { backgroundColor: '#845ef7', paddingVertical: 13, borderRadius: 14, alignItems: 'center', shadowColor: '#845ef7', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  addButtonText:  { color: '#fff', fontWeight: '900', fontSize: 15 },

  ampmRow:        { width: 90, flexDirection: 'row', justifyContent: 'space-between' },
  ampmButton:     { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: '#fff6f0', borderWidth: 1, borderColor: '#ffd6b0' },
  ampmActive:     { backgroundColor: '#06c39a', borderColor: '#06c39a' },
  ampmText:       { color: '#2a6f3d', fontWeight: '700' },
  ampmTextActive: { color: '#fff' },

  deedItem:       { paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#eef2ff', borderRadius: 14, marginRight: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#a5b4fc', width: '47%', minHeight: 40 },
  deedItemActive: { backgroundColor: '#4338ca', borderColor: '#6366f1' },
  deedEmoji:      { marginRight: 6, fontSize: 15, flexShrink: 0 },
  deedLabel:      { color: '#3730a3', fontWeight: '700', fontSize: 13, flexShrink: 1, flexWrap: 'wrap', lineHeight: 17 },
  categoryHeader: { fontSize: 12, fontWeight: '800', color: '#ff9f1c', marginBottom: 8, marginTop: 10, textTransform: 'uppercase', letterSpacing: 1 },

  autoButton:     { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#ffd166', borderRadius: 10, justifyContent: 'center' },
  autoText:       { color: '#6b3d6b', fontWeight: '800', fontSize: 12 },

  infoBox:        { width: '100%', padding: 10, backgroundColor: '#e8fff4', borderRadius: 12, borderWidth: 1, borderColor: '#06c39a', marginBottom: 12 },
  infoText:       { color: '#0b8457', fontWeight: '700', textAlign: 'center', fontSize: 13 },
});
