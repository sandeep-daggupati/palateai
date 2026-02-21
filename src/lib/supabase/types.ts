export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ReceiptUploadStatus = 'uploaded' | 'processing' | 'needs_review' | 'approved';

export interface Restaurant {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface ReceiptUpload {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  status: ReceiptUploadStatus;
  type: 'receipt' | 'menu';
  image_paths: string[];
  dish_image_path: string | null;
  audio_path: string | null;
  currency_detected: string | null;
  created_at: string;
  processed_at: string | null;
}

export interface ExtractedLineItem {
  id: string;
  upload_id: string;
  name_raw: string;
  name_final: string | null;
  price_raw: number | null;
  price_final: number | null;
  confidence: number | null;
  included: boolean;
  created_at: string;
}

export interface DishEntry {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  dish_name: string;
  price_original: number | null;
  currency_original: string;
  price_usd: number | null;
  source_upload_id: string;
  dish_key: string;
  created_at: string;
}
