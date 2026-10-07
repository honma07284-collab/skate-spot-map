const DATABASE_NAME = "roll-call-local";
const DATABASE_VERSION = 1;
const PHOTO_STORE = "spot-photos";

function openPhotoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PHOTO_STORE)) {
        database.createObjectStore(PHOTO_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("写真ストレージを開けませんでした"));
  });
}

export async function saveSpotPhoto(spotId: string, photo: Blob): Promise<void> {
  const database = await openPhotoDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, "readwrite");
    transaction.objectStore(PHOTO_STORE).put(photo, spotId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("写真を保存できませんでした"));
    transaction.onabort = () => reject(transaction.error ?? new Error("写真の保存を中断しました"));
  }).finally(() => database.close());
}

export async function getSpotPhoto(spotId: string): Promise<Blob | null> {
  const database = await openPhotoDatabase();

  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const request = database.transaction(PHOTO_STORE, "readonly").objectStore(PHOTO_STORE).get(spotId);
      request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("写真を読み込めませんでした"));
    });
  } finally {
    database.close();
  }
}

export async function deleteSpotPhoto(spotId: string): Promise<void> {
  const database = await openPhotoDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PHOTO_STORE, "readwrite");
    transaction.objectStore(PHOTO_STORE).delete(spotId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("写真を削除できませんでした"));
    transaction.onabort = () => reject(transaction.error ?? new Error("写真の削除を中断しました"));
  }).finally(() => database.close());
}