import { BackupPayload, Lesson, Student, ThemeMode } from '../types';
import { addDaysISO, generateId, getTodayISO } from '../utils/formatters';

const DB_NAME = 'surucu-takip-db';
const DB_VERSION = 1;
const STORE_STUDENTS = 'students';
const STORE_LESSONS = 'lessons';
const STORE_META = 'meta';

const LS_DATA_KEY = 'surucu-takip-data-v1';
const LS_THEME_KEY = 'surucu-takip-theme';

interface LocalStorageSnapshot {
  students: Student[];
  lessons: Lesson[];
  seeded: boolean;
  updatedAt: number;
}

// In-memory mirror guarantees consistent LocalStorage sync even if IndexedDB is inaccessible
let cachedStudents: Student[] = [];
let cachedLessons: Lesson[] = [];
let cachedSeeded = false;

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access denied under sandboxed content:// or restricted file:// origins
  }
  return null;
}

function readLocalStorageSnapshot(): LocalStorageSnapshot | null {
  const ls = getSafeLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(LS_DATA_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const validated = validateBackupPayload({
      app: 'surucu-takip',
      version: 1,
      exportedAt: '',
      students: obj.students,
      lessons: obj.lessons,
    });
    if (!validated) return null;
    return {
      students: validated.students,
      lessons: validated.lessons,
      seeded: obj.seeded === true || validated.students.length > 0 || validated.lessons.length > 0,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeLocalStorageSnapshot(
  students: Student[],
  lessons: Lesson[],
  seeded = true
): void {
  cachedStudents = students;
  cachedLessons = lessons;
  cachedSeeded = seeded;

  const ls = getSafeLocalStorage();
  if (!ls) return;
  try {
    const snapshot: LocalStorageSnapshot = {
      students,
      lessons,
      seeded,
      updatedAt: Date.now(),
    };
    ls.setItem(LS_DATA_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore quota or private mode storage errors
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error('IndexedDB zaman aşımına uğradı.'));
      }
    }, 1500);

    const finishResolve = (db: IDBDatabase) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(db);
    };

    const finishReject = (err: unknown) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      reject(err instanceof Error ? err : new Error('IndexedDB erişilemedi.'));
    };

    try {
      if (typeof window === 'undefined' || !window.indexedDB) {
        finishReject(new Error('IndexedDB bu tarayıcıda desteklenmiyor.'));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_STUDENTS)) {
          db.createObjectStore(STORE_STUDENTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_LESSONS)) {
          const lessonStore = db.createObjectStore(STORE_LESSONS, { keyPath: 'id' });
          lessonStore.createIndex('studentId', 'studentId', { unique: false });
          lessonStore.createIndex('date', 'date', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => finishResolve(request.result);
      request.onerror = () => finishReject(request.error);
      request.onblocked = () => finishReject(new Error('IndexedDB engellendi.'));
    } catch (err) {
      finishReject(err);
    }
  });
}

async function tryOpenDB(): Promise<IDBDatabase | null> {
  try {
    return await openDB();
  } catch {
    return null;
  }
}

function txPromise<T>(tx: IDBTransaction, work: () => IDBRequest<T> | void): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    let resultValue: T | undefined;
    try {
      const req = work();
      if (req) {
        req.onsuccess = () => {
          resultValue = req.result;
        };
      }
    } catch (err) {
      reject(err);
      return;
    }
    tx.oncomplete = () => resolve(resultValue);
    tx.onerror = () => reject(tx.error ?? new Error('Veritabanı işlemi başarısız oldu.'));
    tx.onabort = () => reject(tx.error ?? new Error('Veritabanı işlemi iptal edildi.'));
  });
}

async function writeFullDatasetToIDB(
  db: IDBDatabase,
  students: Student[],
  lessons: Lesson[],
  seeded = true
): Promise<void> {
  const tx = db.transaction([STORE_STUDENTS, STORE_LESSONS, STORE_META], 'readwrite');
  const studentStore = tx.objectStore(STORE_STUDENTS);
  const lessonStore = tx.objectStore(STORE_LESSONS);
  studentStore.clear();
  lessonStore.clear();
  for (const s of students) {
    studentStore.put(s);
  }
  for (const l of lessons) {
    lessonStore.put(l);
  }
  tx.objectStore(STORE_META).put({ key: 'seeded', value: seeded });
  await txPromise(tx, () => undefined);
}

function buildSampleDataset(): { students: Student[]; lessons: Lesson[] } {
  const today = getTodayISO();
  const now = Date.now();

  const student1Id = generateId();
  const student2Id = generateId();
  const student3Id = generateId();

  const students: Student[] = [
    {
      id: student1Id,
      fullName: 'Ahmet Yılmaz',
      phone: '0532 418 72 90',
      licenseClass: 'B',
      registrationDate: addDaysISO(today, -18),
      totalLessons: 14,
      completedLessons: 9,
      examDate: addDaysISO(today, 3),
      notes: 'Paralel park ve L park çalışması çok iyi. Yokuş kalkışında son tekrar yapılacak.',
      createdAt: now - 3000,
      updatedAt: now - 3000,
    },
    {
      id: student2Id,
      fullName: 'Zeynep Kaya',
      phone: '0544 826 15 34',
      licenseClass: 'B Otomatik',
      registrationDate: addDaysISO(today, -12),
      totalLessons: 12,
      completedLessons: 5,
      examDate: addDaysISO(today, 9),
      notes: 'Kavşak geçişleri ve ayna kontrolü üzerinde durulacak.',
      createdAt: now - 2000,
      updatedAt: now - 2000,
    },
    {
      id: student3Id,
      fullName: 'Murat Demir',
      phone: '0505 719 48 62',
      licenseClass: 'A2',
      registrationDate: addDaysISO(today, -25),
      totalLessons: 10,
      completedLessons: 8,
      examDate: addDaysISO(today, 1),
      notes: 'Slalom ve 8 çizme parkuru hazır. Sınav öncesi son deneme.',
      createdAt: now - 1000,
      updatedAt: now - 1000,
    },
  ];

  const lessons: Lesson[] = [
    {
      id: generateId(),
      studentId: student1Id,
      date: today,
      time: '09:30',
      status: 'completed',
      note: 'Sınav güzergahı tam tur',
      createdAt: now - 500,
      updatedAt: now - 500,
    },
    {
      id: generateId(),
      studentId: student2Id,
      date: today,
      time: '13:30',
      status: 'planned',
      note: 'Şehir içi trafik ve kavşaklar',
      createdAt: now - 400,
      updatedAt: now - 400,
    },
    {
      id: generateId(),
      studentId: student3Id,
      date: today,
      time: '16:00',
      status: 'planned',
      note: 'Sınav alanı son hazırlık',
      createdAt: now - 300,
      updatedAt: now - 300,
    },
    {
      id: generateId(),
      studentId: student1Id,
      date: addDaysISO(today, 1),
      time: '10:00',
      status: 'planned',
      note: 'Yokuş kalkış ve park pratiği',
      createdAt: now - 200,
      updatedAt: now - 200,
    },
    {
      id: generateId(),
      studentId: student2Id,
      date: addDaysISO(today, 2),
      time: '14:30',
      status: 'planned',
      note: 'Geri park ve ani fren çalışması',
      createdAt: now - 100,
      updatedAt: now - 100,
    },
  ];

  return { students, lessons };
}

export async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const db = await tryOpenDB();
  if (!db) return undefined;
  try {
    const tx = db.transaction(STORE_META, 'readonly');
    const store = tx.objectStore(STORE_META);
    const row = await txPromise<{ key: string; value: T } | undefined>(tx, () => store.get(key));
    return row?.value;
  } catch {
    return undefined;
  }
}

export async function setMetaValue<T>(key: string, value: T): Promise<void> {
  const db = await tryOpenDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_META, 'readwrite');
    const store = tx.objectStore(STORE_META);
    await txPromise(tx, () => store.put({ key, value }));
  } catch {
    // Ignore IDB errors when unavailable
  }
}

export async function getThemePreference(): Promise<ThemeMode | undefined> {
  const idbTheme = await getMetaValue<ThemeMode>('theme');
  if (idbTheme === 'light' || idbTheme === 'dark') {
    return idbTheme;
  }
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const lsTheme = window.localStorage.getItem(LS_THEME_KEY);
      if (lsTheme === 'light' || lsTheme === 'dark') return lsTheme;
    } catch {
      // ignore
    }
  }
  return undefined;
}

export async function saveThemePreference(theme: ThemeMode): Promise<void> {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LS_THEME_KEY, theme);
    } catch {
      // ignore
    }
  }
  await setMetaValue('theme', theme);
}

export async function getAllStudents(): Promise<Student[]> {
  const db = await tryOpenDB();
  if (!db) return readLocalStorageSnapshot()?.students ?? cachedStudents;
  try {
    const tx = db.transaction(STORE_STUDENTS, 'readonly');
    const store = tx.objectStore(STORE_STUDENTS);
    const items = await txPromise<Student[]>(tx, () => store.getAll());
    return items ?? [];
  } catch {
    return readLocalStorageSnapshot()?.students ?? cachedStudents;
  }
}

export async function getAllLessons(): Promise<Lesson[]> {
  const db = await tryOpenDB();
  if (!db) return readLocalStorageSnapshot()?.lessons ?? cachedLessons;
  try {
    const tx = db.transaction(STORE_LESSONS, 'readonly');
    const store = tx.objectStore(STORE_LESSONS);
    const items = await txPromise<Lesson[]>(tx, () => store.getAll());
    return items ?? [];
  } catch {
    return readLocalStorageSnapshot()?.lessons ?? cachedLessons;
  }
}

export async function initDatabaseAndSeedIfFirstRun(): Promise<{
  students: Student[];
  lessons: Lesson[];
}> {
  const lsSnapshot = readLocalStorageSnapshot();
  const db = await tryOpenDB();

  let idbAccessible = false;
  let idbSeeded = false;
  let idbStudents: Student[] = [];
  let idbLessons: Lesson[] = [];

  if (db) {
    try {
      const tx = db.transaction([STORE_STUDENTS, STORE_LESSONS, STORE_META], 'readonly');
      const sReq = tx.objectStore(STORE_STUDENTS).getAll();
      const lReq = tx.objectStore(STORE_LESSONS).getAll();
      const mReq = tx.objectStore(STORE_META).get('seeded');

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });

      idbStudents = (sReq.result as Student[]) ?? [];
      idbLessons = (lReq.result as Lesson[]) ?? [];
      idbSeeded = Boolean((mReq.result as { key: string; value: boolean } | undefined)?.value);
      idbAccessible = true;
    } catch {
      idbAccessible = false;
    }
  }

  // 1) IndexedDB erişilebilir ve içinde veri varsa: veriyi kullan ve LocalStorage'a eşitle
  if (idbAccessible && (idbStudents.length > 0 || idbLessons.length > 0)) {
    writeLocalStorageSnapshot(idbStudents, idbLessons, true);
    return { students: idbStudents, lessons: idbLessons };
  }

  // 2) IndexedDB boş veya erişilemez ise: LocalStorage'daki yedeği kontrol et ve geri yükle
  if (lsSnapshot && (lsSnapshot.students.length > 0 || lsSnapshot.lessons.length > 0 || lsSnapshot.seeded)) {
    cachedStudents = lsSnapshot.students;
    cachedLessons = lsSnapshot.lessons;
    cachedSeeded = true;

    if (db && idbAccessible) {
      try {
        await writeFullDatasetToIDB(db, lsSnapshot.students, lsSnapshot.lessons, true);
      } catch {
        // IDB sync best-effort
      }
    }
    return { students: lsSnapshot.students, lessons: lsSnapshot.lessons };
  }

  // 3) Kullanıcı tüm verileri bilerek silmişse (IDB seeded: true, kayıt yok): boş kalsın
  if (idbAccessible && idbSeeded) {
    writeLocalStorageSnapshot([], [], true);
    return { students: [], lessons: [] };
  }

  // 4) İlk açılış: örnek verileri oluştur ve hem IndexedDB hem LocalStorage'a yaz
  const sample = buildSampleDataset();
  writeLocalStorageSnapshot(sample.students, sample.lessons, true);
  if (db) {
    try {
      await writeFullDatasetToIDB(db, sample.students, sample.lessons, true);
    } catch {
      // IDB write best-effort
    }
  }
  return sample;
}

function getBaseSnapshotForMutation(): { students: Student[]; lessons: Lesson[] } {
  const ls = readLocalStorageSnapshot();
  if (ls) {
    return { students: ls.students, lessons: ls.lessons };
  }
  return { students: cachedStudents, lessons: cachedLessons };
}

export async function saveStudent(student: Student): Promise<void> {
  // LocalStorage sync
  const base = getBaseSnapshotForMutation();
  const exists = base.students.some((s) => s.id === student.id);
  const nextStudents = exists
    ? base.students.map((s) => (s.id === student.id ? student : s))
    : [student, ...base.students];
  writeLocalStorageSnapshot(nextStudents, base.lessons, true);

  // IndexedDB sync
  const db = await tryOpenDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_STUDENTS, 'readwrite');
    await txPromise(tx, () => tx.objectStore(STORE_STUDENTS).put(student));
  } catch {
    // LocalStorage already holds the latest snapshot
  }
}

export async function deleteStudentAndLessons(studentId: string): Promise<void> {
  // LocalStorage sync
  const base = getBaseSnapshotForMutation();
  const nextStudents = base.students.filter((s) => s.id !== studentId);
  const nextLessons = base.lessons.filter((l) => l.studentId !== studentId);
  writeLocalStorageSnapshot(nextStudents, nextLessons, true);

  // IndexedDB sync
  const db = await tryOpenDB();
  if (!db) return;
  try {
    const allLessons = await getAllLessons();
    const tx = db.transaction([STORE_STUDENTS, STORE_LESSONS], 'readwrite');
    tx.objectStore(STORE_STUDENTS).delete(studentId);
    const lessonStore = tx.objectStore(STORE_LESSONS);
    for (const lesson of allLessons) {
      if (lesson.studentId === studentId) {
        lessonStore.delete(lesson.id);
      }
    }
    await txPromise(tx, () => undefined);
  } catch {
    // LocalStorage already holds the latest snapshot
  }
}

export async function saveLesson(lesson: Lesson): Promise<void> {
  // LocalStorage sync
  const base = getBaseSnapshotForMutation();
  const exists = base.lessons.some((l) => l.id === lesson.id);
  const nextLessons = exists
    ? base.lessons.map((l) => (l.id === lesson.id ? lesson : l))
    : [...base.lessons, lesson];
  writeLocalStorageSnapshot(base.students, nextLessons, true);

  // IndexedDB sync
  const db = await tryOpenDB();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_LESSONS, 'readwrite');
    await txPromise(tx, () => tx.objectStore(STORE_LESSONS).put(lesson));
  } catch {
    // LocalStorage already holds the latest snapshot
  }
}

export async function saveLessonWithStudent(lesson: Lesson, student: Student): Promise<void> {
  // LocalStorage sync
  const base = getBaseSnapshotForMutation();
  const lessonExists = base.lessons.some((l) => l.id === lesson.id);
  const nextLessons = lessonExists
    ? base.lessons.map((l) => (l.id === lesson.id ? lesson : l))
    : [...base.lessons, lesson];
  const studentExists = base.students.some((s) => s.id === student.id);
  const nextStudents = studentExists
    ? base.students.map((s) => (s.id === student.id ? student : s))
    : [student, ...base.students];
  writeLocalStorageSnapshot(nextStudents, nextLessons, true);

  // IndexedDB sync
  const db = await tryOpenDB();
  if (!db) return;
  try {
    const tx = db.transaction([STORE_LESSONS, STORE_STUDENTS], 'readwrite');
    tx.objectStore(STORE_LESSONS).put(lesson);
    tx.objectStore(STORE_STUDENTS).put(student);
    await txPromise(tx, () => undefined);
  } catch {
    // LocalStorage already holds the latest snapshot
  }
}

export async function deleteLessonWithStudent(lessonId: string, updatedStudent?: Student): Promise<void> {
  // LocalStorage sync
  const base = getBaseSnapshotForMutation();
  const nextLessons = base.lessons.filter((l) => l.id !== lessonId);
  const nextStudents = updatedStudent
    ? base.students.map((s) => (s.id === updatedStudent.id ? updatedStudent : s))
    : base.students;
  writeLocalStorageSnapshot(nextStudents, nextLessons, true);

  // IndexedDB sync
  const db = await tryOpenDB();
  if (!db) return;
  try {
    const tx = db.transaction([STORE_LESSONS, STORE_STUDENTS], 'readwrite');
    tx.objectStore(STORE_LESSONS).delete(lessonId);
    if (updatedStudent) {
      tx.objectStore(STORE_STUDENTS).put(updatedStudent);
    }
    await txPromise(tx, () => undefined);
  } catch {
    // LocalStorage already holds the latest snapshot
  }
}

export async function reseedSampleData(): Promise<{ students: Student[]; lessons: Lesson[] }> {
  const sample = buildSampleDataset();
  writeLocalStorageSnapshot(sample.students, sample.lessons, true);

  const db = await tryOpenDB();
  if (db) {
    try {
      await writeFullDatasetToIDB(db, sample.students, sample.lessons, true);
    } catch {
      // LocalStorage already holds sample data
    }
  }
  return sample;
}

export async function clearAllData(): Promise<void> {
  writeLocalStorageSnapshot([], [], true);

  const db = await tryOpenDB();
  if (db) {
    try {
      await writeFullDatasetToIDB(db, [], [], true);
    } catch {
      // LocalStorage already cleared
    }
  }
}

export async function restoreBackupData(
  students: Student[],
  lessons: Lesson[]
): Promise<{ students: Student[]; lessons: Lesson[] }> {
  writeLocalStorageSnapshot(students, lessons, true);

  const db = await tryOpenDB();
  if (db) {
    try {
      await writeFullDatasetToIDB(db, students, lessons, true);
    } catch {
      // LocalStorage already restored
    }
  }
  return { students, lessons };
}

export function validateBackupPayload(raw: unknown): BackupPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.students) || !Array.isArray(obj.lessons)) return null;

  const validStudents: Student[] = [];
  for (const item of obj.students) {
    if (!item || typeof item !== 'object') return null;
    const s = item as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.fullName !== 'string' || typeof s.phone !== 'string') {
      return null;
    }
    validStudents.push({
      id: s.id,
      fullName: s.fullName,
      phone: s.phone,
      licenseClass: typeof s.licenseClass === 'string' ? s.licenseClass : 'B',
      registrationDate: typeof s.registrationDate === 'string' ? s.registrationDate : getTodayISO(),
      totalLessons: Math.max(0, Number(s.totalLessons) || 0),
      completedLessons: Math.max(0, Number(s.completedLessons) || 0),
      examDate: typeof s.examDate === 'string' ? s.examDate : '',
      notes: typeof s.notes === 'string' ? s.notes : '',
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
    });
  }

  const studentIds = new Set(validStudents.map((s) => s.id));
  const validLessons: Lesson[] = [];
  for (const item of obj.lessons) {
    if (!item || typeof item !== 'object') return null;
    const l = item as Record<string, unknown>;
    if (
      typeof l.id !== 'string' ||
      typeof l.studentId !== 'string' ||
      typeof l.date !== 'string' ||
      typeof l.time !== 'string'
    ) {
      return null;
    }
    if (!studentIds.has(l.studentId)) continue;
    validLessons.push({
      id: l.id,
      studentId: l.studentId,
      date: l.date,
      time: l.time,
      status: l.status === 'completed' ? 'completed' : 'planned',
      note: typeof l.note === 'string' ? l.note : '',
      createdAt: typeof l.createdAt === 'number' ? l.createdAt : Date.now(),
      updatedAt: typeof l.updatedAt === 'number' ? l.updatedAt : Date.now(),
    });
  }

  return {
    app: 'surucu-takip',
    version: typeof obj.version === 'number' ? obj.version : 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    students: validStudents,
    lessons: validLessons,
  };
}
