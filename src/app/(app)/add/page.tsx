'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { getBrowserSupabaseClient } from '@/lib/supabase/browser';
import { uploadImage } from '@/lib/storage/uploadImage';

const fieldLabelClass = 'section-label';

export default function AddPage() {
  const router = useRouter();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const imagePickerRef = useRef<HTMLInputElement | null>(null);
  const imageCameraRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setPhotoPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(imageFile);
    setPhotoPreviewUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [imageFile]);

  const saveReceiptFlow = async () => {
    if (!imageFile) return;

    const supabase = getBrowserSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new Error('Missing user session.');

    const nowIso = new Date().toISOString();

    const { data: createdUpload, error: uploadError } = await supabase
      .from('receipt_uploads')
      .insert({
        user_id: user.id,
        restaurant_id: null,
        status: 'uploaded',
        type: 'receipt',
        image_paths: [],
        visited_at: nowIso,
        visited_at_source: 'fallback',
        is_shared: false,
        share_visibility: 'private',
      })
      .select('id')
      .single();

    if (uploadError) throw uploadError;
    const uploadId = createdUpload.id as string;

    const { data: hangoutExisting, error: hangoutExistingError } = await supabase
      .from('hangouts')
      .select('id')
      .eq('id', uploadId)
      .maybeSingle();
    if (hangoutExistingError) throw hangoutExistingError;

    if (!hangoutExisting) {
      const { error: hangoutInsertError } = await supabase.from('hangouts').insert({
        id: uploadId,
        owner_user_id: user.id,
        restaurant_id: null,
        occurred_at: nowIso,
        note: null,
      });
      if (hangoutInsertError) throw hangoutInsertError;
    }

    const { data: participantExisting, error: participantExistingError } = await supabase
      .from('hangout_participants')
      .select('hangout_id')
      .eq('hangout_id', uploadId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (participantExistingError) throw participantExistingError;

    if (!participantExisting) {
      const { error: participantError } = await supabase.from('hangout_participants').insert({
        hangout_id: uploadId,
        user_id: user.id,
      });
      if (participantError) throw participantError;
    }

    const imagePath = await uploadImage({
      file: imageFile,
      userId: user.id,
      uploadId,
      category: 'temp_receipt',
      onProgress: setProgress,
    });

    const { error: finalizeError } = await supabase
      .from('receipt_uploads')
      .update({
        image_paths: [imagePath],
        audio_path: null,
      })
      .eq('id', uploadId);

    if (finalizeError) throw finalizeError;

    router.push(`/uploads/${uploadId}`);
  };

  const onSubmit = async () => {
    if (!imageFile) return;
    setLoading(true);
    setSaveError(null);
    try {
      await saveReceiptFlow();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4 pb-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-app-text">Add</h1>
      </div>

      <section className="card-surface space-y-4">
        <p className={fieldLabelClass}>Receipt upload</p>

        <input
          ref={imagePickerRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
        />
        <input
          ref={imageCameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
        />

        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="primary" size="sm" onClick={() => imagePickerRef.current?.click()}>
            Upload photo
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => imageCameraRef.current?.click()}>
            Take photo
          </Button>
        </div>

        <p className="text-xs text-app-muted">{imageFile ? `Selected: ${imageFile.name}` : 'No file selected.'}</p>

        {photoPreviewUrl ? (
          <div className="overflow-hidden rounded-xl border border-app-border">
            <Image src={photoPreviewUrl} alt="Selected receipt photo" width={960} height={720} className="h-48 w-full object-cover" unoptimized />
          </div>
        ) : null}

        {loading ? <p className="text-sm text-app-muted">Uploading... {Math.round(progress)}%</p> : null}
        {saveError ? <p className="text-xs text-rose-700 dark:text-rose-300">{saveError}</p> : null}

        <Button type="button" variant="primary" size="lg" onClick={onSubmit} disabled={!imageFile || loading}>
          {loading ? 'Saving...' : 'Continue to review'}
        </Button>
      </section>
    </div>
  );
}
