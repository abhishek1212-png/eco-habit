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
  Animated,
  Button,
  Easing,
  FlatList,
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
  type User,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
  const [now, setNow] = useState(new Date());
  const confettiRef = useRef<any>(null);

  // ── Auth state ────────────────────────────────────────────────────────────────
  const [loggedIn, setLoggedIn] = useState(false);
  const [login, setLogin] = useState<LoginState>({ email: '', password: '' });
  const [storedCredentials, setStoredCredentials] = useState<Credentials | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // ── Streak state ──────────────────────────────────────────────────────────────
  const [globalStreak, setGlobalStreak] = useState(0);
  const [lastActivityDate, setLastActivityDate] = useState<string | null>(null);
  const [streakBroken, setStreakBroken] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [showAllWorld, setShowAllWorld] = useState(false);
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

  const level = Math.floor(xp / 100) + 1;
  const progress = xp % 100;

  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const WORLD_ZONES: { label: string; tz: string }[] = [
    { label: 'Local',    tz: localTz },
    { label: 'UTC',      tz: 'UTC' },
    { label: 'New York', tz: 'America/New_York' },
    { label: 'London',   tz: 'Europe/London' },
    { label: 'Tokyo',    tz: 'Asia/Tokyo' },
    { label: 'Sydney',   tz: 'Australia/Sydney' },
  ];

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const yesterdayStr = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  useEffect(() => {
    (async () => {
      try {
        const [habitsStr, xpStr, notifStr, storedCreds, streakStr, lastDateStr] =
          await Promise.all([
            AsyncStorage.getItem('eco_habits'),
            AsyncStorage.getItem('eco_xp'),
            AsyncStorage.getItem('eco_notifs'),
            AsyncStorage.getItem('eco_user_credentials'),
            AsyncStorage.getItem('eco_global_streak'),
            AsyncStorage.getItem('eco_last_activity_date'),
          ]);

        if (habitsStr) setHabits(JSON.parse(habitsStr));
        if (xpStr) setXp(parseInt(xpStr, 10));
        if (notifStr) { try { setNotifMap(JSON.parse(notifStr)); } catch {} }
        if (storedCreds) {
          try {
            const creds = JSON.parse(storedCreds) as Credentials;
            setStoredCredentials({ email: creds.email });
            setLogin({ email: creds.email, password: '' });
            setUserEmail(creds.email);
          } catch {}
        }

        // Global streak — check for break on load
        const savedStreak = streakStr ? parseInt(streakStr, 10) : 0;
        const savedLastDate = lastDateStr ?? null;
        setLastActivityDate(savedLastDate);

        if (savedStreak > 0 && savedLastDate) {
          const yesterday = yesterdayStr();
          const today = todayStr();
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
    (async () => {
      try {
        await Promise.all([
          AsyncStorage.setItem('eco_habits', JSON.stringify(habits)),
          AsyncStorage.setItem('eco_xp', String(xp)),
          AsyncStorage.setItem('eco_notifs', JSON.stringify(notifMap)),
          AsyncStorage.setItem('eco_global_streak', String(globalStreak)),
          AsyncStorage.setItem('eco_last_activity_date', lastActivityDate ?? ''),
        ]);
      } catch (err) {
        console.log('Failed to save to AsyncStorage', err);
      }
    })();
  }, [habits, xp, notifMap, globalStreak, lastActivityDate]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user: User | null) => {
      if (user) {
        setFirebaseUser(user);
        setLoggedIn(true);
        setUserEmail(user.email || '');
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
    saveRemoteUserData(firebaseUser.uid);
  }, [habits, xp, notifMap, globalStreak, lastActivityDate, firebaseUser]);

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
          notifMap?: Record<string, string>;
          globalStreak?: number;
          lastActivityDate?: string;
        };
        if (remote.habits) setHabits(remote.habits);
        if (typeof remote.xp === 'number') setXp(remote.xp);
        if (remote.notifMap) setNotifMap(remote.notifMap);
        if (typeof remote.globalStreak === 'number') setGlobalStreak(remote.globalStreak);
        if (remote.lastActivityDate) setLastActivityDate(remote.lastActivityDate);
      } else {
        await setDoc(userDoc, { habits, xp, notifMap, globalStreak, lastActivityDate });
      }
    } catch (err) {
      console.log('Failed to load remote user data', err);
    }
  };

  const saveRemoteUserData = async (uid: string) => {
    try {
      const userDoc = doc(db, 'eco_users', uid);
      await setDoc(userDoc, { habits, xp, notifMap, globalStreak, lastActivityDate }, { merge: true });
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
      confettiRef.current?.start();

      // Per-habit streak
      const today = todayStr();
      const yest = yesterdayStr();
      const newHabitStreak =
        h.lastCompletedDate === yest || h.lastCompletedDate === today
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
        const newGlobal =
          lastActivityDate === yest ? globalStreak + 1 : 1;
        setGlobalStreak(newGlobal);
        setLastActivityDate(today);
        setStreakBroken(false);
      }
    } else {
      scheduleForHabit(id, h.title, h.time);
      setXp((v) => Math.max(0, v - XP_PER));
      setHabits((prev) =>
        prev.map((hh) =>
          hh.id === id
            ? { ...hh, completed: false, streak: Math.max(0, (hh.streak || 1) - 1) }
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
    const completed = habits.filter((h) => h.completed);
    completed.forEach((h) => cancelForHabit(h.id));
    setHabits((s) => s.filter((h) => !h.completed));
  };

  const handleLogin = async () => {
    const email = login.email.trim().toLowerCase();
    const password = login.password;
    if (!email || !password) { alert('Enter both email and password'); return; }
    if (!EMAIL_PATTERN.test(email)) { alert('Please enter a valid email address'); return; }
    try {
      let userCredential;
      try {
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      } catch (err: any) {
        if (err.code === 'auth/user-not-found') {
          userCredential = await createUserWithEmailAndPassword(auth, email, password);
        } else {
          alert('Invalid email or password');
          return;
        }
      }
      const user = userCredential.user;
      await AsyncStorage.setItem('eco_user_credentials', JSON.stringify({ email }));
      setStoredCredentials({ email });
      setUserEmail(email);
      setLogin({ email, password: '' });
      setLoggedIn(true);
      setFirebaseUser(user);
      await loadRemoteUserData(user.uid);
    } catch (err) {
      alert('Unable to sign in. Please check your credentials and network.');
    }
  };

  const handleLogout = async () => {
    try { await signOut(auth); } catch {}
    AsyncStorage.removeItem('eco_user_credentials').catch(() => {});
    setStoredCredentials(null);
    setLogin({ email: '', password: '' });
    setUserEmail('');
    setLoggedIn(false);
    setFirebaseUser(null);
  };

  // ── Login Screen ──────────────────────────────────────────────────────────────

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <LinearGradient colors={['#6ee7b7', '#3b82f6', '#ec4899']} style={styles.gradient} start={[0, 0]} end={[1, 1]}>
          <StatusBar style="light" />
          <View style={styles.loginContainer}>
            <Text style={styles.loginTitle}>Welcome to Eco Habit</Text>
            <EarthMascot />
            <Text style={styles.loginNotice}>
              Use your email and password to sign in. The first login creates a secure account.
            </Text>
            <TextInput
              style={[styles.input, styles.loginInput]}
              placeholder="example@gmail.com"
              placeholderTextColor="#7a9b7a"
              value={login.email}
              onChangeText={(v) => setLogin((p) => ({ ...p, email: v }))}
              autoCapitalize="none"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextInput
              style={[styles.input, styles.loginInput]}
              placeholder="Password"
              placeholderTextColor="#7a9b7a"
              value={login.password}
              onChangeText={(v) => setLogin((p) => ({ ...p, password: v }))}
              secureTextEntry
              textContentType="password"
            />
            <TouchableOpacity style={[styles.addButton, styles.loginButton]} onPress={handleLogin} accessibilityRole="button">
              <Text style={styles.addButtonText}>Login / Sign up</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  // ── Main Screen ───────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient colors={['#e6f7ea', '#d7f3d9', '#ffffff']} style={styles.gradient} start={[0, 0]} end={[1, 1]}>
        <StatusBar style="dark" />
        <ScrollView contentContainerStyle={styles.container}>

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logo}>🌿 Eco Habit</Text>
            <Text style={styles.tag}>Small reminders for greener days</Text>
            <View style={styles.xpRow}>
              <View>
                <Text style={styles.xpText}>XP: {xp}</Text>
                <Text style={styles.xpText}>Level {level}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.userLabel}>{userEmail || 'Not signed in'}</Text>
                <TouchableOpacity onPress={handleLogout} style={styles.logoutButton}>
                  <Text style={styles.logoutText}>Logout</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>1 task completed = 10 XP</Text>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${progress}%` }]} />
            </View>
          </View>

          {/* ── Streak Tree Card ── */}
          <View style={styles.card}>
            <Text style={styles.section}>Your Streak Tree</Text>
            <Text style={styles.cardSubtitle}>
              Complete at least one habit every day to grow your tree. Miss a day and it gets chopped! 🪓
            </Text>
            <StreakTree streak={globalStreak} broken={streakBroken} />
            {/* Streak progress dots (up to 7 days shown) */}
            <View style={streakDotStyles.row}>
              {Array.from({ length: 7 }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    streakDotStyles.dot,
                    i < globalStreak % 7 || (globalStreak > 0 && globalStreak % 7 === 0)
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

          {/* ── Eco Tree Progress Card ── */}
          <View style={styles.card}>
            <Text style={styles.section}>Eco Tree Progress</Text>
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

          {/* ── Add Custom Deed ── */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginRight: 8 }]}
              placeholder="Emoji (e.g. 🌿)"
              value={newDeedEmoji}
              onChangeText={setNewDeedEmoji}
            />
            <TextInput
              style={[styles.input, { flex: 2, marginRight: 8 }]}
              placeholder="New eco deed!"
              value={newDeedLabel}
              onChangeText={setNewDeedLabel}
            />
            <TouchableOpacity
              style={[styles.addButton, { paddingHorizontal: 12 }]}
              onPress={() => {
                if (!newDeedLabel.trim()) { alert('Please enter a deed label'); return; }
                const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                setCustomDeeds((d) => [...d, { id, label: newDeedLabel.trim(), emoji: newDeedEmoji || '✅' }]);
                setNewDeedLabel('');
                setNewDeedEmoji('');
              }}
            >
              <Text style={styles.addButtonText}>Add deed</Text>
            </TouchableOpacity>
          </View>

          {/* ── World Clock ── */}
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.section}>World Clock</Text>
              <TouchableOpacity onPress={() => setShowAllWorld((s) => !s)} style={styles.toggleButton}>
                <Text style={styles.toggleText}>{showAllWorld ? 'Hide' : 'Show all'}</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.worldRow}>
              {WORLD_ZONES.filter((z) => showAllWorld || z.tz === localTz).map((z) => {
                const isLocal = z.tz === localTz;
                return (
                  <View
                    key={z.tz}
                    style={[
                      styles.worldItem,
                      isLocal && styles.localHighlight,
                      { width: isTablet ? '30%' : '48%' },
                    ]}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Text style={styles.worldLabel}>{z.label}</Text>
                      {isLocal && <Text style={styles.detectedBadge}>Detected</Text>}
                    </View>
                    <Text style={styles.worldTime}>{fmtTime(now, z.tz)}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* ── Add Reminder ── */}
          <View style={styles.card}>
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
                        style={[
                          styles.deedItem,
                          active && styles.deedItemActive,
                          {
                            width: isTablet ? '30%' : '48%',
                            flexDirection: isTablet ? 'column' : 'row',
                            alignItems: isTablet ? 'flex-start' : 'center',
                          },
                        ]}
                        onPress={() => setSelectedDeed(d.id)}
                      >
                        <Text style={[styles.deedEmoji, isTablet && { fontSize: 22, marginBottom: 6 }]}>{d.emoji}</Text>
                        <Text style={[styles.deedLabel, isTablet && { fontSize: 16 }]}>{d.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
            {customDeeds.length > 0 && (
              <View style={{ marginBottom: 12 }}>
                <Text style={styles.categoryHeader}>My Custom Deeds</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                  {customDeeds.map((d) => {
                    const active = selectedDeed === d.id;
                    return (
                      <TouchableOpacity
                        key={d.id}
                        style={[styles.deedItem, active && styles.deedItemActive, { width: isTablet ? '30%' : '48%' }]}
                        onPress={() => setSelectedDeed(d.id)}
                      >
                        <Text style={styles.deedEmoji}>{d.emoji}</Text>
                        <Text style={styles.deedLabel}>{d.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
            <Text style={{ color: '#547a56', marginBottom: 8 }}>Choose one deed above; no custom text required.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1, marginRight: 8 }]}
                placeholder="Time (HH:MM)"
                value={time}
                onChangeText={setTime}
                onSubmitEditing={add}
              />
              <TextInput
                style={[styles.input, { width: 90, marginRight: 8 }]}
                placeholder="MM-DD"
                value={date}
                onChangeText={setDate}
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
          <View style={styles.card}>
            <Text style={styles.section}>Upcoming</Text>
            {upcoming.length === 0 ? (
              <Text style={styles.empty}>No upcoming reminders</Text>
            ) : (
              <FlatList
                data={upcoming}
                keyExtractor={(i) => i.id}
                scrollEnabled={false}
                renderItem={({ item }) => (
                  <View style={[styles.row, item.completed && styles.rowDone]}>
                    <View style={styles.rowText}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text style={[styles.title, item.completed && styles.titleDone]}>{item.title}</Text>
                        {(item.streak ?? 0) > 0 && (
                          <View style={styles.streakBadge}>
                            <Text style={styles.streakText}>🔥 {item.streak}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.meta}>{item.time}</Text>
                    </View>
                    <View style={styles.actions}>
                      <TouchableOpacity style={styles.smallButton} onPress={() => toggle(item.id)}>
                        <Text style={styles.smallText}>{item.completed ? 'Undo' : 'Done'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.smallButton, styles.delete]} onPress={() => remove(item.id)}>
                        <Text style={styles.smallText}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              />
            )}
          </View>

          <View style={styles.footer}>
            <Button title="Clear completed" onPress={  clearCompleted} />
            <Text style={styles.footerNote}>Made with ♻️ and 🌱</Text>
          </View>

        </ScrollView>

        <ConfettiCannon
          ref={confettiRef}
          count={100}
          origin={{ x: -10, y: 0 }}
          autoStart={false}
        />
      </LinearGradient>
    </SafeAreaView>
  );
}

// ─── Streak Dot Styles ────────────────────────────────────────────────────────

const streakDotStyles = StyleSheet.create({
  row:       { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 8 },
  dot:       { width: 12, height: 12, borderRadius: 6 },
  dotFilled: { backgroundColor: '#22c55e' },
  dotEmpty:  { backgroundColor: '#d1fae5', borderWidth: 1, borderColor: '#86efac' },
  label:     { textAlign: 'center', color: '#15803d', fontWeight: '700', marginTop: 6, fontSize: 13 },
});

// ─── Main Styles ──────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea:      { flex: 1, backgroundColor: 'transparent' },
  gradient:      { flex: 1 },
  container:     { padding: 16, paddingBottom: 40 },
  header:        { alignItems: 'center', marginBottom: 12 },
  logo:          { fontSize: 28, fontWeight: '800', color: '#0b8457' },
  tag:           { color: '#2b7a78', marginTop: 4 },
  xpRow:         { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingTop: 8 },
  xpText:        { color: '#ff6b6b', fontWeight: '700' },
  progressBar:   { width: '100%', height: 10, backgroundColor: '#fff2d6', borderRadius: 10, marginTop: 8, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: '#06c39a' },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  section:       { fontSize: 16, fontWeight: '700', color: '#0b8457', marginBottom: 4 },
  cardSubtitle:  { color: '#547a56', fontSize: 13, marginBottom: 4 },

  // Eco Tree Progress
  treeContainer:    { marginTop: 8 },
  treeRow:          { flexDirection: 'row', marginBottom: 10 },
  treeMarkerColumn: { alignItems: 'center', width: 36 },
  treeNode:         { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  treeNodeActive:   { backgroundColor: '#22c55e' },
  treeNodeInactive: { backgroundColor: '#e5e7eb' },
  treeNodeEmoji:    { fontSize: 16 },
  treeConnector:    { width: 2, flex: 1, backgroundColor: '#d1fae5', minHeight: 10 },
  treeMeta:         { flex: 1, paddingLeft: 10, justifyContent: 'center' },
  treeNodeTitle:    { fontWeight: '700', color: '#1a3d1f', fontSize: 14 },
  treeNodeMeta:     { color: '#547a56', fontSize: 12, marginTop: 2 },
  treeProgressBar:  { height: 6, backgroundColor: '#f0fdf4', borderRadius: 4, marginTop: 4, overflow: 'hidden' },
  treeProgressFill: { height: '100%', backgroundColor: '#22c55e' },
  treeStatus:       { textAlign: 'center', color: '#0b8457', fontWeight: '700', marginTop: 8 },

  input:         { borderWidth: 1, borderColor: '#f3e8ff', borderRadius: 10, padding: 10, marginBottom: 8, backgroundColor: '#fffaf6' },
  empty:         { color: '#6b8a6a' },
  row:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  rowDone:       { opacity: 0.6 },
  rowText:       { flex: 1, paddingRight: 8 },
  title:         { fontSize: 15, fontWeight: '700', color: '#234b2a' },
  titleDone:     { textDecorationLine: 'line-through', color: '#6b8a6a' },
  meta:          { color: '#7a9b7a', marginTop: 2 },
  actions:       { flexDirection: 'row' },
  smallButton:   { backgroundColor: '#06c39a', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, marginLeft: 8 },
  smallText:     { color: '#fff', fontWeight: '700' },
  delete:        { backgroundColor: '#ff6b6b' },
  streakBadge:   { marginLeft: 6, backgroundColor: '#fff3cd', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: '#ffc107' },
  streakText:    { fontSize: 12, fontWeight: '700', color: '#b45309' },

  footer:        { alignItems: 'center', marginTop: 8 },
  footerNote:    { color: '#587a5a', marginTop: 8 },

  loginContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 32, margin: 18, shadowColor: '#0f766e', shadowOpacity: 0.2, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } },
  loginTitle:     { fontSize: 28, fontWeight: '900', color: '#0f766e', marginBottom: 14, letterSpacing: 0.5 },
  loginEmojiRow:  { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 12 },
  loginEmoji:     { fontSize: 24 },
  loginNotice:    { color: '#134e4a', marginBottom: 20, textAlign: 'center', maxWidth: 320, lineHeight: 22 },
  loginInput:     { backgroundColor: '#f8fffb', borderColor: '#c7f5e7', borderWidth: 1, borderRadius: 16, padding: 14, shadowColor: '#86efac', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  loginButton:    { backgroundColor: '#10b981', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 28 },

  userLabel:      { color: '#547a56', fontWeight: '700', marginBottom: 6 },
  logoutButton:   { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#ff6b6b' },
  logoutText:     { color: '#fff', fontWeight: '700' },

  worldRow:       { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 8 },
  worldItem:      { backgroundColor: '#f0f8ff', padding: 10, borderRadius: 10, marginBottom: 8 },
  worldLabel:     { color: '#1f6fbe', fontWeight: '700' },
  worldTime:      { color: '#0b8457', marginTop: 4, fontWeight: '800' },
  localHighlight: { borderWidth: 1, borderColor: '#06c39a', backgroundColor: '#e8fff4' },
  detectedBadge:  { backgroundColor: '#06c39a', color: '#fff', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, fontWeight: '700', fontSize: 12 },
  toggleButton:   { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#ff9f1c', borderRadius: 8 },
  toggleText:     { color: '#fff', fontWeight: '700' },

  addButton:      { backgroundColor: '#845ef7', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  addButtonText:  { color: '#fff', fontWeight: '800' },

  ampmRow:        { width: 90, flexDirection: 'row', justifyContent: 'space-between' },
  ampmButton:     { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, backgroundColor: '#fff6f0' },
  ampmActive:     { backgroundColor: '#06c39a' },
  ampmText:       { color: '#2a6f3d', fontWeight: '700' },
  ampmTextActive: { color: '#fff' },

  deedItem:       { padding: 10, backgroundColor: '#fff7fb', borderRadius: 12, marginRight: 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  deedItemActive: { borderWidth: 1, borderColor: '#ff6b6b', backgroundColor: '#fff0f2' },
  deedEmoji:      { marginRight: 8, fontSize: 18 },
  deedLabel:      { color: '#6b3d6b', fontWeight: '700' },
  categoryHeader: { fontSize: 13, fontWeight: '800', color: '#ff9f1c', marginBottom: 6, marginTop: 4 },

  autoButton:     { paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#ffd166', borderRadius: 8, justifyContent: 'center' },
  autoText:       { color: '#6b3d6b', fontWeight: '700', fontSize: 12 },

  infoBox:        { width: '100%', padding: 10, backgroundColor: '#e8fff4', borderRadius: 12, borderWidth: 1, borderColor: '#06c39a', marginBottom: 12 },
  infoText:       { color: '#0b8457', fontWeight: '700', textAlign: 'center' },
});
