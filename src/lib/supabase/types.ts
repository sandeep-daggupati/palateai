export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export type ReceiptUploadStatus = 'uploaded' | 'processing' | 'needs_review' | 'approved' | 'rejected' | 'failed';
export type DishIdentityTag = Database['public']['Enums']['dish_identity'];
export type ShareVisibility = 'private' | 'public';
export type VisitParticipantRole = 'host' | 'participant';
export type VisitParticipantStatus = 'active' | 'invited' | 'removed';

export type Database = {
  public: {
    Tables: {
      restaurants: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          place_id: string | null;
          address: string | null;
          lat: number | null;
          lng: number | null;
          phone_number: string | null;
          website: string | null;
          maps_url: string | null;
          opening_hours: Json | null;
          utc_offset_minutes: number | null;
          google_rating: number | null;
          price_level: number | null;
          business_status: string | null;
          last_place_sync: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          place_id?: string | null;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          phone_number?: string | null;
          website?: string | null;
          maps_url?: string | null;
          opening_hours?: Json | null;
          utc_offset_minutes?: number | null;
          google_rating?: number | null;
          price_level?: number | null;
          business_status?: string | null;
          last_place_sync?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          place_id?: string | null;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          phone_number?: string | null;
          website?: string | null;
          maps_url?: string | null;
          opening_hours?: Json | null;
          utc_offset_minutes?: number | null;
          google_rating?: number | null;
          price_level?: number | null;
          business_status?: string | null;
          last_place_sync?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          email: string | null;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          email?: string | null;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          email?: string | null;
          updated_at?: string;
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
          audio_path: string | null;
          currency_detected: string | null;
          visited_at: string | null;
          visit_lat: number | null;
          visit_lng: number | null;
          visit_rating: number | null;
          visit_note: string | null;
          is_shared: boolean;
          share_visibility: ShareVisibility;
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
          audio_path?: string | null;
          currency_detected?: string | null;
          visited_at?: string | null;
          visit_lat?: number | null;
          visit_lng?: number | null;
          visit_rating?: number | null;
          visit_note?: string | null;
          is_shared?: boolean;
          share_visibility?: ShareVisibility;
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
          audio_path?: string | null;
          currency_detected?: string | null;
          visited_at?: string | null;
          visit_lat?: number | null;
          visit_lng?: number | null;
          visit_rating?: number | null;
          visit_note?: string | null;
          is_shared?: boolean;
          share_visibility?: ShareVisibility;
          created_at?: string;
          processed_at?: string | null;
        };
        Relationships: [];
      };
      visit_participants: {
        Row: {
          id: string;
          visit_id: string;
          user_id: string | null;
          role: VisitParticipantRole;
          invited_email: string | null;
          status: VisitParticipantStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          visit_id: string;
          user_id?: string | null;
          role?: VisitParticipantRole;
          invited_email?: string | null;
          status?: VisitParticipantStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          visit_id?: string;
          user_id?: string | null;
          role?: VisitParticipantRole;
          invited_email?: string | null;
          status?: VisitParticipantStatus;
          created_at?: string;
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
          quantity: number | null;
          unit_price: number | null;
          group_key: string | null;
          grouped: boolean | null;
          duplicate_of: string | null;
          rating: number | null;
          comment: string | null;
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
          quantity?: number | null;
          unit_price?: number | null;
          group_key?: string | null;
          grouped?: boolean | null;
          duplicate_of?: string | null;
          rating?: number | null;
          comment?: string | null;
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
          quantity?: number | null;
          unit_price?: number | null;
          group_key?: string | null;
          grouped?: boolean | null;
          duplicate_of?: string | null;
          rating?: number | null;
          comment?: string | null;
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
          quantity: number | null;
          eaten_at: string | null;
          source_upload_id: string;
          dish_key: string;
          identity_tag: Database['public']['Enums']['dish_identity'] | null;
          rating: number | null;
          comment: string | null;
          had_it: boolean | null;
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
          quantity?: number | null;
          eaten_at?: string | null;
          source_upload_id: string;
          dish_key: string;
          identity_tag?: Database['public']['Enums']['dish_identity'] | null;
          rating?: number | null;
          comment?: string | null;
          had_it?: boolean | null;
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
          quantity?: number | null;
          eaten_at?: string | null;
          source_upload_id?: string;
          dish_key?: string;
          identity_tag?: Database['public']['Enums']['dish_identity'] | null;
          rating?: number | null;
          comment?: string | null;
          had_it?: boolean | null;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_insights: {
        Row: {
          id: string;
          user_id: string;
          insight_text: string;
          metrics_snapshot: Json;
          category: 'palate' | 'explore' | 'spend' | 'wildcard';
          evidence_type: 'dish' | 'restaurant' | 'hangout' | 'summary';
          evidence: Json;
          generated_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          insight_text: string;
          metrics_snapshot: Json;
          category: 'palate' | 'explore' | 'spend' | 'wildcard';
          evidence_type: 'dish' | 'restaurant' | 'hangout' | 'summary';
          evidence: Json;
          generated_at?: string;
          expires_at: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          insight_text?: string;
          metrics_snapshot?: Json;
          category?: 'palate' | 'explore' | 'spend' | 'wildcard';
          evidence_type?: 'dish' | 'restaurant' | 'hangout' | 'summary';
          evidence?: Json;
          generated_at?: string;
          expires_at?: string;
        };
        Relationships: [];
      };
      daily_insight_history: {
        Row: {
          id: string;
          user_id: string;
          insight_id: string | null;
          category: 'palate' | 'explore' | 'spend' | 'wildcard';
          insight_text: string;
          generated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          insight_id?: string | null;
          category: 'palate' | 'explore' | 'spend' | 'wildcard';
          insight_text: string;
          generated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          insight_id?: string | null;
          category?: 'palate' | 'explore' | 'spend' | 'wildcard';
          insight_text?: string;
          generated_at?: string;
        };
        Relationships: [];
      };
      dish_name_mappings: {
        Row: {
          id: string;
          user_id: string;
          restaurant_id: string | null;
          raw_name: string;
          normalized_name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id?: string | null;
          raw_name: string;
          normalized_name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string | null;
          raw_name?: string;
          normalized_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      dish_identity: 'go_to' | 'hidden_gem' | 'special_occasion' | 'try_again' | 'never_again';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Restaurant = Database['public']['Tables']['restaurants']['Row'];
export type ReceiptUpload = Database['public']['Tables']['receipt_uploads']['Row'];
export type VisitParticipant = Database['public']['Tables']['visit_participants']['Row'];
export type ExtractedLineItem = Database['public']['Tables']['extracted_line_items']['Row'];
export type DishEntry = Database['public']['Tables']['dish_entries']['Row'];
export type DailyInsight = Database['public']['Tables']['daily_insights']['Row'];

export type TableRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];









