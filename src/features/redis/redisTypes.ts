export interface RedisKeyEntry {
  key: string;
  key_type: string;
  ttl: number;
}

export interface RedisKeyListResponse {
  total_count: number;
  entries: RedisKeyEntry[];
}
