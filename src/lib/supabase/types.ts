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
          place_type: 'google' | 'pinned';
          name: string;
          place_id: string | null;
          address: string | null;
          custom_name: string | null;
          approx_address: string | null;
          accuracy_meters: number | null;
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
          place_type?: 'google' | 'pinned';
          name: string;
          place_id?: string | null;
          address?: string | null;
          custom_name?: string | null;
          approx_address?: string | null;
          accuracy_meters?: number | null;
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
          place_type?: 'google' | 'pinned';
          name?: string;
          place_id?: string | null;
          address?: string | null;
          custom_name?: string | null;
          approx_address?: string | null;
          accuracy_meters?: number | null;
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
          onboarded: boolean;
          onboarding_completed: boolean;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          email?: string | null;
          onboarded?: boolean;
          onboarding_completed?: boolean;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string | null;
          avatar_url?: string | null;
          email?: string | null;
          onboarded?: boolean;
          onboarding_completed?: boolean;
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
          visited_at_source: string | null;
          visit_lat: number | null;
          visit_lng: number | null;
          visit_rating: number | null;
          visit_note: string | null;
          vibe_tags: string[] | null;
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
          visited_at_source?: string | null;
          visit_lat?: number | null;
          visit_lng?: number | null;
          visit_rating?: number | null;
          visit_note?: string | null;
          vibe_tags?: string[] | null;
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
          visited_at_source?: string | null;
          visit_lat?: number | null;
          visit_lng?: number | null;
          visit_rating?: number | null;
          visit_note?: string | null;
          vibe_tags?: string[] | null;
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
          hangout_id: string | null;
          hangout_item_id: string | null;
          dish_name: string;
          price_original: number | null;
          currency_original: string;
          price_usd: number | null;
          quantity: number | null;
          eaten_at: string | null;
          source_upload_id: string;
          dish_key: string;
          identity_tag: Database['public']['Enums']['dish_identity'] | null;
          cuisine: string | null;
          flavor_tags: string[] | null;
          rating: number | null;
          comment: string | null;
          had_it: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          restaurant_id?: string | null;
          hangout_id?: string | null;
          hangout_item_id?: string | null;
          dish_name: string;
          price_original?: number | null;
          currency_original: string;
          price_usd?: number | null;
          quantity?: number | null;
          eaten_at?: string | null;
          source_upload_id: string;
          dish_key: string;
          identity_tag?: Database['public']['Enums']['dish_identity'] | null;
          cuisine?: string | null;
          flavor_tags?: string[] | null;
          rating?: number | null;
          comment?: string | null;
          had_it?: boolean | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          restaurant_id?: string | null;
          hangout_id?: string | null;
          hangout_item_id?: string | null;
          dish_name?: string;
          price_original?: number | null;
          currency_original?: string;
          price_usd?: number | null;
          quantity?: number | null;
          eaten_at?: string | null;
          source_upload_id?: string;
          dish_key?: string;
          identity_tag?: Database['public']['Enums']['dish_identity'] | null;
          cuisine?: string | null;
          flavor_tags?: string[] | null;
          rating?: number | null;
          comment?: string | null;
          had_it?: boolean | null;
          created_at?: string;
        };
        Relationships: [];
      };
      dish_entry_participants: {
        Row: {
          id: string;
          dish_entry_id: string;
          user_id: string;
          had_it: boolean;
          rating: number | null;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          dish_entry_id: string;
          user_id: string;
          had_it?: boolean;
          rating?: number | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          dish_entry_id?: string;
          user_id?: string;
          had_it?: boolean;
          rating?: number | null;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      personal_food_entries: {
        Row: {
          id: string;
          user_id: string;
          source_dish_entry_id: string | null;
          source_hangout_id: string | null;
          restaurant_id: string | null;
          dish_key: string | null;
          dish_name: string;
          price: number | null;
          photo_path: string | null;
          rating: number | null;
          note: string | null;
          reaction_tag: Database['public']['Enums']['dish_identity'] | null;
          had_it: boolean;
          detached_from_hangout: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_dish_entry_id?: string | null;
          source_hangout_id?: string | null;
          restaurant_id?: string | null;
          dish_key?: string | null;
          dish_name: string;
          price?: number | null;
          photo_path?: string | null;
          rating?: number | null;
          note?: string | null;
          reaction_tag?: Database['public']['Enums']['dish_identity'] | null;
          had_it?: boolean;
          detached_from_hangout?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_dish_entry_id?: string | null;
          source_hangout_id?: string | null;
          restaurant_id?: string | null;
          dish_key?: string | null;
          dish_name?: string;
          price?: number | null;
          photo_path?: string | null;
          rating?: number | null;
          note?: string | null;
          reaction_tag?: Database['public']['Enums']['dish_identity'] | null;
          had_it?: boolean;
          detached_from_hangout?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      hangouts: {
        Row: {
          id: string;
          owner_user_id: string;
          restaurant_id: string | null;
          occurred_at: string;
          note: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_user_id: string;
          restaurant_id?: string | null;
          occurred_at?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_user_id?: string;
          restaurant_id?: string | null;
          occurred_at?: string;
          note?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      hangout_participants: {
        Row: {
          hangout_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          hangout_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          hangout_id?: string;
          user_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      hangout_sources: {
        Row: {
          id: string;
          hangout_id: string;
          type: 'receipt' | 'dish_photo' | 'hangout_photo' | 'manual';
          storage_path: string | null;
          extractor: 'openai' | null;
          extracted_at: string | null;
          extraction_version: string | null;
          raw_extraction: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          hangout_id: string;
          type: 'receipt' | 'dish_photo' | 'hangout_photo' | 'manual';
          storage_path?: string | null;
          extractor?: 'openai' | null;
          extracted_at?: string | null;
          extraction_version?: string | null;
          raw_extraction?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          hangout_id?: string;
          type?: 'receipt' | 'dish_photo' | 'hangout_photo' | 'manual';
          storage_path?: string | null;
          extractor?: 'openai' | null;
          extracted_at?: string | null;
          extraction_version?: string | null;
          raw_extraction?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      hangout_items: {
        Row: {
          id: string;
          hangout_id: string;
          source_id: string | null;
          name_raw: string;
          name_final: string | null;
          quantity: number;
          unit_price: number | null;
          currency: string | null;
          line_total: number | null;
          confidence: number | null;
          included: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          hangout_id: string;
          source_id?: string | null;
          name_raw: string;
          name_final?: string | null;
          quantity?: number;
          unit_price?: number | null;
          currency?: string | null;
          confidence?: number | null;
          included?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          hangout_id?: string;
          source_id?: string | null;
          name_raw?: string;
          name_final?: string | null;
          quantity?: number;
          unit_price?: number | null;
          currency?: string | null;
          confidence?: number | null;
          included?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      hangout_summaries: {
        Row: {
          hangout_id: string;
          summary_text: string;
          caption_text: string | null;
          caption_source: string | null;
          caption_generated_at: string | null;
          caption_options: Json | null;
          metadata: Json | null;
          generated_at: string;
        };
        Insert: {
          hangout_id: string;
          summary_text: string;
          caption_text?: string | null;
          caption_source?: string | null;
          caption_generated_at?: string | null;
          caption_options?: Json | null;
          metadata?: Json | null;
          generated_at?: string;
        };
        Update: {
          hangout_id?: string;
          summary_text?: string;
          caption_text?: string | null;
          caption_source?: string | null;
          caption_generated_at?: string | null;
          caption_options?: Json | null;
          metadata?: Json | null;
          generated_at?: string;
        };
        Relationships: [];
      };
      hangout_vibe_memories: {
        Row: {
          id: string;
          hangout_id: string;
          user_id: string;
          vibe_tags: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          hangout_id: string;
          user_id: string;
          vibe_tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          hangout_id?: string;
          user_id?: string;
          vibe_tags?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      dish_catalog: {
        Row: {
          dish_key: string;
          name_canonical: string;
          description: string | null;
          cuisine: string | null;
          flavor_tags: string[] | null;
          generated_at: string;
        };
        Insert: {
          dish_key: string;
          name_canonical: string;
          description?: string | null;
          cuisine?: string | null;
          flavor_tags?: string[] | null;
          generated_at?: string;
        };
        Update: {
          dish_key?: string;
          name_canonical?: string;
          description?: string | null;
          cuisine?: string | null;
          flavor_tags?: string[] | null;
          generated_at?: string;
        };
        Relationships: [];
      };
      photos: {
        Row: {
          id: string;
          user_id: string;
          hangout_id: string | null;
          dish_entry_id: string | null;
          kind: 'hangout' | 'dish';
          storage_original: string;
          storage_medium: string;
          storage_thumb: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          hangout_id?: string | null;
          dish_entry_id?: string | null;
          kind: 'hangout' | 'dish';
          storage_original: string;
          storage_medium: string;
          storage_thumb: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          hangout_id?: string | null;
          dish_entry_id?: string | null;
          kind?: 'hangout' | 'dish';
          storage_original?: string;
          storage_medium?: string;
          storage_thumb?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      daily_ai_insights: {
        Row: {
          user_id: string;
          insight_date: string;
          insight_text: string;
          insight_type: string;
          metadata: Json | null;
          generated_at: string;
        };
        Insert: {
          user_id: string;
          insight_date: string;
          insight_text: string;
          insight_type: string;
          metadata?: Json | null;
          generated_at?: string;
        };
        Update: {
          user_id?: string;
          insight_date?: string;
          insight_text?: string;
          insight_type?: string;
          metadata?: Json | null;
          generated_at?: string;
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
    Functions: {
      daily_insight_stats: {
        Args: {
          p_user_id: string;
          p_days: number;
        };
        Returns: Json;
      };
      daily_insight_stats_7d: {
        Args: {
          p_user_id: string;
        };
        Returns: Json;
      };
      daily_insight_stats_14d: {
        Args: {
          p_user_id: string;
        };
        Returns: Json;
      };
      daily_insight_stats_30d: {
        Args: {
          p_user_id: string;
        };
        Returns: Json;
      };
      delete_hangout_preserve_personal_memories: {
        Args: {
          p_hangout_id: string;
          p_request_user_id: string;
        };
        Returns: Json;
      };
    };
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
export type Hangout = Database['public']['Tables']['hangouts']['Row'];
export type HangoutParticipant = Database['public']['Tables']['hangout_participants']['Row'];
export type HangoutSource = Database['public']['Tables']['hangout_sources']['Row'];
export type HangoutItem = Database['public']['Tables']['hangout_items']['Row'];
export type HangoutSummary = Database['public']['Tables']['hangout_summaries']['Row'];
export type HangoutVibeMemory = Database['public']['Tables']['hangout_vibe_memories']['Row'];
export type DishCatalog = Database['public']['Tables']['dish_catalog']['Row'];
export type DishEntry = Database['public']['Tables']['dish_entries']['Row'];
export type DishEntryParticipant = Database['public']['Tables']['dish_entry_participants']['Row'];
export type PersonalFoodEntry = Database['public']['Tables']['personal_food_entries']['Row'];
export type DailyAiInsight = Database['public']['Tables']['daily_ai_insights']['Row'];
export type DailyInsight = Database['public']['Tables']['daily_insights']['Row'];
export type Photo = Database['public']['Tables']['photos']['Row'];

export type TableRow<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TableInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TableUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
