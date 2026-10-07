"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  Crosshair,
  MapPin,
  MapPinned,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import {
  AttributionControl,
  Map,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import AccountPanel from "./account-panel";
import { deleteSpotPhoto, getSpotPhoto, saveSpotPhoto } from "./photo-store";
import { CloudSpot, Profile, supabase } from "./supabase";

const SPOTS_STORAGE_KEY = "skate-spot-map:spots";
const SPOT_TYPES = ["レール", "カーブ", "フラット", "バンク"] as const;
type SpotType = (typeof SPOT_TYPES)[number];

type Spot = {
  id: string;
  name: string;
  note: string;
  types: SpotType[];
  hasPhoto?: boolean;
  photoPath?: string | null;
  ownerId?: string;
  ownerUsername?: string;
  ownerAvatar?: string;
  lng: number;
  lat: number;
};

type DraftLocation = { lng: number; lat: number };
type DraftPhoto = { file: File; previewUrl: string };

async function optimizePhoto(file: File): Promise<Blob> {
  try {
    const image = await createImageBitmap(file);
    const maxDimension = 1440;
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");

    if (!context) {
      image.close();
      return file;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.82);
    });
  } catch {
    return file;
  }
}

function SavedSpotPhoto({ spotId, photoPath }: { spotId: string; photoPath?: string | null }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadPhoto = async () => {
      if (photoPath && supabase) {
        const { data, error } = await supabase.storage.from("spot-photos").createSignedUrl(photoPath, 60);
        if (error || !data || cancelled) return;
        setPhotoUrl(data.signedUrl);
        return;
      }
      const photo = await getSpotPhoto(spotId);
      if (!photo || cancelled) return;
      objectUrl = URL.createObjectURL(photo);
      setPhotoUrl(objectUrl);
    };
    loadPhoto().catch(() => undefined);

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoPath, spotId]);

  if (!photoUrl) return null;
  return (
    <div className="detail-photo-frame">
      <Image src={photoUrl} alt="スポットの写真" fill sizes="(max-width: 640px) 100vw, 390px" unoptimized />
    </div>
  );
}

function createSpotId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

export default function Home() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const draftMarkerRef = useRef<Marker | null>(null);
  const draftPhotoUrlRef = useRef<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [mapReady, setMapReady] = useState(false);
  const [cloudSpots, setCloudSpots] = useState<Spot[]>([]);
  const [localSpots, setLocalSpots] = useState<Spot[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [draftLocation, setDraftLocation] = useState<DraftLocation | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [draftTypes, setDraftTypes] = useState<SpotType[]>([]);
  const [draftPhoto, setDraftPhoto] = useState<DraftPhoto | null>(null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  const [formError, setFormError] = useState("");
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<SpotType | "すべて">("すべて");
  const [panelExpanded, setPanelExpanded] = useState(false);

  const spots = user ? cloudSpots : localSpots;
  const activeProfile = profile?.id === user?.id ? profile : null;
  const visibleSpots = useMemo(
    () =>
      activeFilter === "すべて"
        ? spots
        : spots.filter((spot) => spot.types.includes(activeFilter)),
    [activeFilter, spots],
  );
  const selectedSpot = spots.find((spot) => spot.id === selectedSpotId) ?? null;

  useEffect(() => () => {
    if (draftPhotoUrlRef.current) URL.revokeObjectURL(draftPhotoUrlRef.current);
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      try {
        const storedSpots = window.localStorage.getItem(SPOTS_STORAGE_KEY);
        if (storedSpots) {
          const parsedSpots = JSON.parse(storedSpots) as Spot[];
          setLocalSpots(parsedSpots);
        }
      } catch {
        window.localStorage.removeItem(SPOTS_STORAGE_KEY);
      }
      setStorageReady(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUser(data.session?.user ?? null);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!storageReady || !user || !supabase) return;

    let cancelled = false;
    async function loadCloudData() {
      const [profileResult, spotsResult] = await Promise.all([
        supabase!.from("profiles").select("id,username,avatar").eq("id", user!.id).single(),
        supabase!.from("spots").select("id,owner_id,name,note,types,has_photo,photo_path,lng,lat,created_at").order("created_at", { ascending: false }),
      ]);
      if (profileResult.error) throw profileResult.error;
      if (spotsResult.error) throw spotsResult.error;

      const cloudSpots = (spotsResult.data ?? []) as (CloudSpot & { created_at: string })[];
      const ownerIds = [...new Set(cloudSpots.map((spot) => spot.owner_id))];
      const ownersResult = ownerIds.length
        ? await supabase!.from("profiles").select("id,username,avatar").in("id", ownerIds)
        : { data: [], error: null };
      if (ownersResult.error) throw ownersResult.error;
      const owners = new globalThis.Map(((ownersResult.data ?? []) as Profile[]).map((owner) => [owner.id, owner]));
      if (cancelled) return;

      setProfile(profileResult.data as Profile);
      setCloudSpots(cloudSpots.map((spot) => ({
        id: spot.id,
        name: spot.name,
        note: spot.note,
        types: spot.types as SpotType[],
        hasPhoto: spot.has_photo,
        photoPath: spot.photo_path,
        ownerId: spot.owner_id,
        ownerUsername: owners.get(spot.owner_id)?.username,
        ownerAvatar: owners.get(spot.owner_id)?.avatar,
        lng: spot.lng,
        lat: spot.lat,
      })));
    }

    loadCloudData().catch(() => {
      if (!cancelled) setCloudSpots([]);
    });
    return () => { cancelled = true; };
  }, [storageReady, user]);

  useEffect(() => {
    if (!storageReady || user) return;
    window.localStorage.setItem(SPOTS_STORAGE_KEY, JSON.stringify(spots));
  }, [spots, storageReady, user]);

  useEffect(() => {
    if (!mapContainer.current) return;

    setWorkerUrl("/maplibre-gl-worker.mjs");
    const map = new Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          openstreetmap: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "openstreetmap", type: "raster", source: "openstreetmap" }],
      },
      center: [135.5, 34.7],
      zoom: 12,
      attributionControl: false,
    });
    mapRef.current = map;
    const handleResize = () => map.resize();
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainer.current);
    window.addEventListener("resize", handleResize);
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.on("load", () => setMapReady(true));
    map.on("click", (event: MapMouseEvent) => {
      setSelectedSpotId(null);
      setDraftLocation({ lng: event.lngLat.lng, lat: event.lngLat.lat });
      setPanelExpanded(true);
    });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = visibleSpots.map((spot) => {
      const markerElement = document.createElement("button");
      markerElement.type = "button";
      markerElement.className = `spot-marker${spot.id === selectedSpotId ? " is-selected" : ""}`;
      markerElement.setAttribute("aria-label", spot.name);
      markerElement.title = spot.name;
      markerElement.innerHTML = '<span class="spot-marker__dot"></span>';
      markerElement.addEventListener("click", (event) => {
        event.stopPropagation();
        setDraftLocation(null);
        setSelectedSpotId(spot.id);
        setPanelExpanded(true);
      });

      return new Marker({ element: markerElement, anchor: "bottom" })
        .setLngLat([spot.lng, spot.lat])
        .addTo(map);
    });
  }, [mapReady, selectedSpotId, visibleSpots]);

  useEffect(() => {
    draftMarkerRef.current?.remove();
    draftMarkerRef.current = null;

    if (!mapRef.current || !mapReady || !draftLocation) return;

    const markerElement = document.createElement("div");
    markerElement.className = "draft-marker";
    markerElement.setAttribute("aria-label", "追加するスポットの位置");
    markerElement.innerHTML = '<span class="draft-marker__pin"><span>+</span></span>';
    draftMarkerRef.current = new Marker({ element: markerElement, anchor: "bottom" })
      .setLngLat([draftLocation.lng, draftLocation.lat])
      .addTo(mapRef.current);

    return () => {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
    };
  }, [draftLocation, mapReady]);

  function toggleDraftType(type: SpotType) {
    setDraftTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  function handlePhotoSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFormError("画像ファイルを選択してください");
      event.target.value = "";
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setFormError("写真は20MB以下のものを選んでください");
      event.target.value = "";
      return;
    }

    if (draftPhotoUrlRef.current) URL.revokeObjectURL(draftPhotoUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    draftPhotoUrlRef.current = previewUrl;
    setDraftPhoto({ file, previewUrl });
    setFormError("");
  }

  function clearDraftPhoto() {
    if (draftPhotoUrlRef.current) URL.revokeObjectURL(draftPhotoUrlRef.current);
    draftPhotoUrlRef.current = null;
    setDraftPhoto(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  async function handleAddSpot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draftLocation || isSavingPhoto) return;
    if (!draftName.trim()) {
      setFormError("スポット名を入力してください");
      event.currentTarget.querySelector<HTMLInputElement>("#spot-name")?.focus();
      return;
    }
    const spot: Spot = {
      id: createSpotId(),
      name: draftName.trim(),
      note: draftNote.trim(),
      types: draftTypes,
      hasPhoto: Boolean(draftPhoto),
      ...draftLocation,
    };

    if (user && supabase) {
      setIsSavingPhoto(true);
      let photoPath: string | null = null;
      try {
        if (draftPhoto) {
          photoPath = `${user.id}/${spot.id}/photo.jpg`;
          const { error: uploadError } = await supabase.storage
            .from("spot-photos")
            .upload(photoPath, await optimizePhoto(draftPhoto.file), { contentType: "image/jpeg" });
          if (uploadError) throw uploadError;
        }
        const { error: insertError } = await supabase.from("spots").insert({
          id: spot.id,
          owner_id: user.id,
          name: spot.name,
          note: spot.note,
          types: spot.types,
          has_photo: Boolean(photoPath),
          photo_path: photoPath,
          lng: spot.lng,
          lat: spot.lat,
        });
        if (insertError) throw insertError;
      } catch {
        if (photoPath) await supabase.storage.from("spot-photos").remove([photoPath]);
        setFormError("写真を保存できませんでした。別の写真でもう一度お試しください");
        setIsSavingPhoto(false);
        return;
      }
      setIsSavingPhoto(false);
      spot.hasPhoto = Boolean(photoPath);
      spot.photoPath = photoPath;
      spot.ownerId = user.id;
      spot.ownerUsername = activeProfile?.username;
      spot.ownerAvatar = activeProfile?.avatar;
    } else if (draftPhoto) {
      setIsSavingPhoto(true);
      try {
        await saveSpotPhoto(spot.id, await optimizePhoto(draftPhoto.file));
      } catch {
        setFormError("写真を保存できませんでした。別の写真でもう一度お試しください");
        setIsSavingPhoto(false);
        return;
      }
      setIsSavingPhoto(false);
    }

    if (user && supabase) setCloudSpots((current) => [spot, ...current]);
    else setLocalSpots((current) => [spot, ...current]);
    setActiveFilter("すべて");
    setDraftLocation(null);
    setDraftName("");
    setDraftNote("");
    setDraftTypes([]);
    clearDraftPhoto();
    setFormError("");
    setSelectedSpotId(spot.id);
    setPanelExpanded(true);
  }

  async function deleteSpot(spot: Spot) {
    if (spot.ownerId && supabase) {
      const { error: deleteError } = await supabase.from("spots").delete().eq("id", spot.id);
      if (deleteError) {
        setFormError("スポットを削除できませんでした");
        return;
      }
      if (spot.photoPath) await supabase.storage.from("spot-photos").remove([spot.photoPath]);
    } else {
      void deleteSpotPhoto(spot.id).catch(() => undefined);
    }
    if (spot.ownerId && user) setCloudSpots((current) => current.filter((currentSpot) => currentSpot.id !== spot.id));
    else setLocalSpots((current) => current.filter((currentSpot) => currentSpot.id !== spot.id));
    setSelectedSpotId(null);
  }

  function focusSpot(spot: Spot) {
    setDraftLocation(null);
    setSelectedSpotId(spot.id);
    setPanelExpanded(true);
    mapRef.current?.flyTo({ center: [spot.lng, spot.lat], zoom: 15, essential: true });
  }

  function closeDetail() {
    setDraftLocation(null);
    setSelectedSpotId(null);
  }

  function startAddAtMapCenter() {
    const map = mapRef.current;
    if (!map) return;

    const center = map.unproject([
      mapContainer.current?.clientWidth ?? 0,
      mapContainer.current?.clientHeight ?? 0,
    ]);
    setSelectedSpotId(null);
    setDraftLocation({ lng: center.lng, lat: center.lat });
    setPanelExpanded(true);
  }

  function useMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapRef.current?.flyTo({
        center: [coords.longitude, coords.latitude],
        zoom: 15,
        essential: true,
      });
    });
  }

  async function importLocalSpots() {
    if (!user || !supabase) throw new Error("ログインしてから移行してください");
    const importedSpots: Spot[] = [];

    for (const localSpot of localSpots) {
      const { data: existing, error: lookupError } = await supabase
        .from("spots")
        .select("id")
        .eq("owner_id", user.id)
        .eq("source_id", localSpot.id)
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (existing) continue;

      const newId = createSpotId();
      let photoPath: string | null = null;
      let hasPhoto = false;
      const localPhoto = localSpot.hasPhoto ? await getSpotPhoto(localSpot.id) : null;
      if (localPhoto) {
        photoPath = `${user.id}/${newId}/photo.jpg`;
        const { error: uploadError } = await supabase.storage
          .from("spot-photos")
          .upload(photoPath, localPhoto, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;
        hasPhoto = true;
      }

      const { data: inserted, error: insertError } = await supabase
        .from("spots")
        .insert({
          id: newId,
          owner_id: user.id,
          source_id: localSpot.id,
          name: localSpot.name,
          note: localSpot.note,
          types: localSpot.types,
          has_photo: hasPhoto,
          photo_path: photoPath,
          lng: localSpot.lng,
          lat: localSpot.lat,
        })
        .select("id")
        .single();
      if (insertError) {
        if (photoPath) await supabase.storage.from("spot-photos").remove([photoPath]);
        throw insertError;
      }
      importedSpots.push({
        ...localSpot,
        id: inserted.id,
        hasPhoto,
        photoPath,
        ownerId: user.id,
        ownerUsername: activeProfile?.username,
        ownerAvatar: activeProfile?.avatar,
      });
    }

    if (importedSpots.length) setCloudSpots((current) => [...importedSpots, ...current]);
  }

  return (
    <main className="map-app">
      <div ref={mapContainer} className="map-canvas" aria-label="スケートスポット地図" />

      <button className="location-button" type="button" onClick={useMyLocation} aria-label="現在地へ移動" title="現在地へ移動">
        <Crosshair size={19} strokeWidth={1.8} />
      </button>

      <aside className={`spot-panel${panelExpanded ? " is-expanded" : " is-collapsed"}`}>
        <header className="panel-header">
          <div className="brand-mark" aria-hidden="true"><MapPinned size={24} strokeWidth={1.8} /></div>
          <div className="brand-copy">
            <span className="brand-kicker">SPOT YOUR LINE</span>
            <h1>ROLL CALL</h1>
          </div>
          <span className="spot-count"><strong>{spots.length}</strong><span>SPOTS</span></span>
          <button className="account-trigger" type="button" onClick={() => setAccountOpen(true)} aria-label={user ? "アカウントを開く" : "ログインまたは新規登録"}>
            <span>{activeProfile?.avatar ?? <CircleUserRound size={18} />}</span>
            <span>{activeProfile?.username ? `@${activeProfile.username}` : "ログイン"}</span>
          </button>
          <button
            className="panel-toggle"
            type="button"
            aria-label={panelExpanded ? "パネルを閉じる" : "スポット一覧を開く"}
            aria-expanded={panelExpanded}
            onClick={() => setPanelExpanded((expanded) => !expanded)}
          >
            {panelExpanded ? <ChevronDown size={19} /> : <ChevronUp size={19} />}
          </button>
        </header>

        {draftLocation ? (
          <section className="panel-content form-panel" aria-labelledby="form-title">
            <button className="back-button" type="button" onClick={closeDetail}>
              <ArrowLeft size={16} /> 地図に戻る
            </button>
            <div className="section-heading">
              <span className="section-index">NEW SPOT / 01</span>
              <h2 id="form-title">ここをスポットにする</h2>
              <p>{draftLocation.lat.toFixed(5)}, {draftLocation.lng.toFixed(5)}</p>
            </div>
            <form className="spot-form" onSubmit={handleAddSpot}>
              <label className="field-label" htmlFor="spot-name">スポット名</label>
              <input
                id="spot-name"
                className="text-input"
                value={draftName}
                onChange={(event) => {
                  setDraftName(event.target.value);
                  setFormError("");
                }}
                placeholder="例：高架下の広場"
                maxLength={48}
                aria-invalid={Boolean(formError && !draftName.trim())}
              />

              <fieldset className="type-fieldset">
                <legend className="field-label">セクション <span>任意・複数選択</span></legend>
                <div className="type-options">
                  {SPOT_TYPES.map((type, index) => (
                    <button
                      className={`type-option type-option--${index}${draftTypes.includes(type) ? " is-active" : ""}`}
                      type="button"
                      aria-pressed={draftTypes.includes(type)}
                      key={type}
                      onClick={() => {
                        toggleDraftType(type);
                        setFormError("");
                      }}
                    >
                      <span className="type-option__mark" />{type}
                    </button>
                  ))}
                </div>
              </fieldset>

              <label className="field-label" htmlFor="spot-note">メモ <span>任意</span></label>
              <textarea
                id="spot-note"
                className="text-input text-area"
                value={draftNote}
                onChange={(event) => setDraftNote(event.target.value)}
                placeholder="路面や時間帯など"
                maxLength={180}
                rows={3}
              />
              <div className="photo-field">
                <span className="field-label">写真 <span>任意・1枚</span></span>
                <input
                  ref={photoInputRef}
                  id="spot-photo"
                  className="photo-input"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                />
                {draftPhoto ? (
                  <div className="photo-preview">
                    <Image src={draftPhoto.previewUrl} alt="追加する写真のプレビュー" fill sizes="350px" unoptimized />
                    <button className="photo-remove" type="button" onClick={clearDraftPhoto} aria-label="写真を外す">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <label className="photo-picker" htmlFor="spot-photo">
                    <Camera size={18} /> 写真を撮る・選ぶ
                  </label>
                )}
              </div>
              <button className="primary-button" type="submit" disabled={isSavingPhoto}>
                <Plus size={17} /> {isSavingPhoto ? "写真を保存中..." : "スポットを追加"}
              </button>
              {formError ? <p className="form-hint form-error" role="alert">{formError}</p> : <p className="form-hint">セクションはあとから絞り込みに使えます</p>}
            </form>
          </section>
        ) : selectedSpot ? (
          <section className="panel-content detail-panel">
            <button className="back-button" type="button" onClick={closeDetail}>
              <ArrowLeft size={16} /> スポット一覧
            </button>
            <div className="detail-topline">
              <span className="section-index">SPOT / {String(spots.indexOf(selectedSpot) + 1).padStart(2, "0")}</span>
              {(!selectedSpot.ownerId || selectedSpot.ownerId === user?.id) && (
                <button className="icon-button delete-button" type="button" onClick={() => void deleteSpot(selectedSpot)} aria-label="スポットを削除" title="スポットを削除">
                  <Trash2 size={17} />
                </button>
              )}
            </div>
            <h2 className="detail-title">{selectedSpot.name}</h2>
            {selectedSpot.ownerUsername && <p className="spot-owner"><span>{selectedSpot.ownerAvatar ?? "🛹"}</span>@{selectedSpot.ownerUsername} のスポット</p>}
            {selectedSpot.types.length > 0 ? (
              <div className="detail-types">
                {selectedSpot.types.map((type) => <span className="detail-type" key={type}>{type}</span>)}
              </div>
            ) : <p className="detail-note is-empty">セクション未設定</p>}
            {selectedSpot.hasPhoto && <SavedSpotPhoto key={selectedSpot.id} spotId={selectedSpot.id} photoPath={selectedSpot.photoPath} />}
            {selectedSpot.note ? <p className="detail-note">{selectedSpot.note}</p> : <p className="detail-note is-empty">メモはまだありません</p>}
            <div className="coordinates"><MapPin size={15} /> {selectedSpot.lat.toFixed(5)}, {selectedSpot.lng.toFixed(5)}</div>
          </section>
        ) : (
          <>
            <section className="panel-content browse-panel">
              <div className="section-heading browse-heading">
                <span className="section-index">OSAKA / JAPAN</span>
                <h2>街のラインを探す。</h2>
                <p>マップをクリックしてスポットを記録</p>
              </div>
              <div className="filter-row" aria-label="セクションで絞り込み">
                {(["すべて", ...SPOT_TYPES] as const).map((type) => (
                  <button
                    className={`filter-button${activeFilter === type ? " is-active" : ""}`}
                    type="button"
                    key={type}
                    onClick={() => setActiveFilter(type)}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <div className="list-heading">
                <span>スポット</span>
                <span>{visibleSpots.length}件</span>
              </div>
              {visibleSpots.length ? (
                <ul className="spot-list">
                  {visibleSpots.map((spot, index) => (
                    <li key={spot.id}>
                      <button className="spot-row" type="button" onClick={() => focusSpot(spot)}>
                        <span className={`spot-number spot-number--${index % 4}`}>{String(index + 1).padStart(2, "0")}</span>
                        <span className="spot-row__body">
                          <strong>{spot.name}</strong>
                          <span>{spot.types.join(" · ")}</span>
                        </span>
                        <MapPin className="spot-row__pin" size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-state">
                  <span className="empty-state__icon"><MapPin size={20} /></span>
                  <p>{activeFilter === "すべて" ? "まだスポットがありません" : `${activeFilter}のスポットはありません`}</p>
                  <span>地図をタップして最初の1件を追加</span>
                </div>
              )}
            </section>
            <footer className="panel-footer">
              <span className="local-indicator" />{user ? "アカウントに同期中" : "このブラウザに保存中"}
              <span className="footer-mark">R / C</span>
            </footer>
          </>
        )}
      </aside>

      {draftLocation && (
        <button className="map-dismiss" type="button" onClick={() => setDraftLocation(null)} aria-label="追加をキャンセル">
          <X size={18} />
        </button>
      )}
      {!draftLocation && !selectedSpot && (
        <button className="map-prompt" type="button" onClick={startAddAtMapCenter}>
          <span><Plus size={15} /></span><span className="map-prompt__desktop">地図をクリックしてスポットを追加</span><span className="map-prompt__mobile">スポットを追加</span>
        </button>
      )}
      <AccountPanel
        open={accountOpen}
        user={user}
        profile={activeProfile}
        localSpotCount={localSpots.length}
        onClose={() => setAccountOpen(false)}
        onProfileChange={setProfile}
        onImportLocal={importLocalSpots}
      />
    </main>
  );
}