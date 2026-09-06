export interface TranscriptionInfo {
  transcription_file_id: string;
  transcription_type: string;
  filename: string;
  format: string | null;
  language: string | null;
  transcript_url: string;
}

export interface TranscriptionEditRequest {
  text?: string;
  language?: string;
  transcription_type?: string;
}

export interface ClipItem {
  clip_id: string;
  label: string | null;
  filename: string;
  view_angle: string | null;
  video_url: string;
  transcription: TranscriptionInfo | null;
}

export interface ClipGroup {
  clip_group_id: string;
  color: string | null;
  start_time_seconds: number | null;
  end_time_seconds: number | null;
  clips: ClipItem[];
  transcription: TranscriptionInfo | null;
}

export interface TakeClips {
  take_id: string;
  take_name: string | null;
  session_id: string | null;
  session_name: string | null;
  recorded_at: string | null;
  groups: ClipGroup[];
  ungrouped_clips: ClipItem[];
}

export interface PaginatedClips {
  items: TakeClips[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** A cluster is either a real clip_group or a synthetic one-clip group for
 *  an ungrouped clip — the UI treats both the same way. */
export interface Cluster {
  key: string;
  color: string | null;
  duration: number | null;
  clips: ClipItem[];
  transcription: TranscriptionInfo | null;
}