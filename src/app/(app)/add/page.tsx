'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { Restaurant } from '@/lib/supabase/types';
import { uploadAudio } from '@/lib/storage/uploadAudio';
import { uploadImage } from '@/lib/storage/uploadImage';

export default function AddPage() {
  const router = useRouter();
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [dishFile, setDishFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<'receipt' | 'menu'>('receipt');
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [restaurantId, setRestaurantId] = useState<string>('');
  const [manualRestaurant, setManualRestaurant] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    const loadRestaurants = async () => {
      const supabase = getBrowserSupabaseClient();
      const { data } = await supabase
        .from('restaurants')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(8);
      setRestaurants((data ?? []) as Restaurant[]);
    };

    loadRestaurants();
  }, []);

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => chunksRef.current.push(event.data);
    recorder.onstop = () => setAudioBlob(new Blob(chunksRef.current, { type: 'audio/webm' }));
    recorder.start();
    mediaRecorderRef.current = recorder;
    setRecording(true);
  };

  const onSubmit = async () => {
    if (!receiptFile) return;
    setLoading(true);

    try {
      const supabase = getBrowserSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error('Missing user session.');

      let finalRestaurantId: string | null = restaurantId || null;
      if (!finalRestaurantId && manualRestaurant.trim()) {
        const { data: createdRestaurant, error: restaurantError } = await supabase
          .from('restaurants')
          .insert({ user_id: user.id, name: manualRestaurant.trim() })
          .select('id')
          .single();
        if (restaurantError) throw restaurantError;
        finalRestaurantId = createdRestaurant.id;
      }

      const { data: createdUpload, error: uploadError } = await supabase
        .from('receipt_uploads')
        .insert({
          user_id: user.id,
          restaurant_id: finalRestaurantId,
          status: 'uploaded',
          type: uploadType,
          image_paths: [],
        })
        .select('id')
        .single();

      if (uploadError) throw uploadError;

      const uploadId = createdUpload.id as string;
      const receiptPath = await uploadImage({
        file: receiptFile,
        userId: user.id,
        uploadId,
        category: uploadType,
        onProgress: setProgress,
      });

      let dishPath: string | null = null;
      if (dishFile) {
        dishPath = await uploadImage({ file: dishFile, userId: user.id, uploadId, category: 'dish' });
      }

      let audioPath: string | null = null;
      if (audioBlob) {
        audioPath = await uploadAudio({ blob: audioBlob, userId: user.id, uploadId });
      }

      await supabase
        .from('receipt_uploads')
        .update({
          image_paths: [receiptPath],
          dish_image_path: dishPath,
          audio_path: audioPath,
        })
        .eq('id', uploadId);

      router.push(`/uploads/${uploadId}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <h1 className="text-xl font-bold">Add upload</h1>
      <div className="rounded-xl bg-white p-4 shadow-sm space-y-3">
        <label className="text-sm font-medium">Receipt/Menu Image</label>
        <Input type="file" accept="image/*" capture="environment" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />

        <label className="text-sm font-medium">Optional Dish Photo</label>
        <Input type="file" accept="image/*" capture="environment" onChange={(e) => setDishFile(e.target.files?.[0] ?? null)} />

        <label className="text-sm font-medium">Upload Type</label>
        <select
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value as 'receipt' | 'menu')}
        >
          <option value="receipt">Receipt</option>
          <option value="menu">Menu</option>
        </select>

        <label className="text-sm font-medium">Recent restaurants</label>
        <select
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
          value={restaurantId}
          onChange={(e) => setRestaurantId(e.target.value)}
        >
          <option value="">Select one (optional)</option>
          {restaurants.map((restaurant) => (
            <option key={restaurant.id} value={restaurant.id}>
              {restaurant.name}
            </option>
          ))}
        </select>

        <label className="text-sm font-medium">Or enter restaurant manually</label>
        <Input
          placeholder="Restaurant name"
          value={manualRestaurant}
          onChange={(e) => setManualRestaurant(e.target.value)}
        />

        <Button type="button" className="bg-indigo-600 hover:bg-indigo-500" onClick={toggleRecording}>
          {recording ? 'Stop recording' : audioBlob ? 'Re-record audio note' : 'Record audio note'}
        </Button>
        {audioBlob && <p className="text-xs text-emerald-700">Audio note attached.</p>}

        {loading && <p className="text-xs text-slate-500">Uploading… {Math.round(progress)}%</p>}
        <Button type="button" onClick={onSubmit} disabled={!receiptFile || loading}>
          Save upload
        </Button>
      </div>
    </div>
  );
}
