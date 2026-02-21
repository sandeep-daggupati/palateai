export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ReceiptUploadStatus = 'uploaded' | 'processing' | 'needs_review' | 'approved';

export type Database = {
  public: {
    Tables: {
      restaurants: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      receipt_uploads: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id?: string | null;
          status: ReceiptUploadStatus;
          type: 'receipt' | 'menu';
          image_paths?: string[];
          dish_image_path?: string | null;
          audio_path?: string | null;
          currency_detected?: string | null;
          created_at?: string;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string | null;
          status?: ReceiptUploadStatus;
          type?: 'receipt' | 'menu';
          image_paths?: string[];
          dish_image_path?: string | null;
          audio_path?: string | null;
          currency_detected?: string | null;
          created_at?: string;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      extracted_line_items: {
        Row: {
          id: string;
          upload_id: string;
          name_raw: string;
          name_final: string | null;
          price_raw: number | null;
          price_final: number | null;
          confidence: number | null;
          included: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          upload_id: string;
          name_raw: string;
          name_final?: string | null;
          price_raw?: number | null;
          price_final?: number | null;
          confidence?: number | null;
          included?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          upload_id?: string;
          name_raw?: string;
          name_final?: string | null;
          price_raw?: number | null;
          price_final?: number | null;
          confidence?: number | null;
          included?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      dish_entries: {
        Row: {
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
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id?: string | null;
          dish_name: string;
          price_original?: number | null;
          currency_original: string;
          price_usd?: number | null;
          source_upload_id: string;
          dish_key: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string | null;
          dish_name?: string;
          price_original?: number | null;
          currency_original?: string;
          price_usd?: number | null;
          source_upload_id?: string;
          dish_key?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type Restaurant = Database['public']['Tables']['restaurants']['Row'];
export type ReceiptUpload = Database['public']['Tables']['receipt_uploads']['Row'];
export type ExtractedLineItem = Database['public']['Tables']['extracted_line_items']['Row'];
export type DishEntry = Database['public']['Tables']['dish_entries']['Row'];

export type TableRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];

