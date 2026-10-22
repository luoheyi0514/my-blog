export type PostStatus = 'draft' | 'published';

export interface Post {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  content_md: string;
  content_html: string;
  toc_json: string | null;
  cover_url: string | null;
  category_id: number | null;
  series_id: number | null;
  series_order: number | null;
  status: PostStatus;
  published_at: string | null;
  pinned: number;
  allow_comments: number;
  word_count: number;
  reading_time: number;
  view_count: number;
  like_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PostListItem extends Post {
  category_name: string | null;
  category_slug: string | null;
  tags: Tag[];
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  sort_order: number;
  post_count?: number;
}

export interface Tag {
  id: number;
  name: string;
  slug: string;
  count?: number;
}

export interface Series {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  status: 'ongoing' | 'completed';
  featured: number;
  planned_chapters: string | null;
  sort_order: number;
  post_count?: number;
  updated_at?: string | null;
}

export interface Til {
  id: number;
  title: string;
  content_md: string;
  content_html: string;
  published_at: string | null;
  status: PostStatus;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  tags?: Tag[];
}

export interface RoadmapArea {
  id: number;
  name: string;
  sort_order: number;
  items: RoadmapItem[];
}

export interface RoadmapItem {
  id: number;
  area_id: number;
  name: string;
  icon: string | null;
  status: 'planned' | 'learning' | 'mastered';
  progress: number;
  start_date: string | null;
  end_date: string | null;
  note: string | null;
  sort_order: number;
  links?: RoadmapLink[];
}

export interface RoadmapLink {
  id: number;
  item_id: number;
  type: 'post' | 'series' | 'til';
  target_id: number;
  label: string | null;
  href?: string;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  cover_url: string | null;
  tech_stack: string | null;
  repo_url: string | null;
  demo_url: string | null;
  status: 'developing' | 'completed' | 'archived';
  featured: number;
  sort_order: number;
}

export interface Media {
  id: number;
  filename: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface Settings {
  site_name: string;
  site_subtitle: string;
  site_description: string;
  author_name: string;
  author_avatar: string;
  author_bio: string;
  tech_stack: string[];
  socials: { label: string; url: string }[];
  about_md: string;
  posts_per_page: number;
  homepage: {
    show_latest_posts: boolean;
    show_series: boolean;
    show_til: boolean;
    show_roadmap: boolean;
  };
  giscus: {
    enabled: boolean;
    repo: string;
    repo_id: string;
    category: string;
    category_id: string;
  };
  [key: string]: unknown;
}

export interface TocItem {
  depth: number;
  text: string;
  slug: string;
}
