export interface RedisKeyEntry {
  key: string;
  key_type: string;
  ttl: number;
}

export interface RedisKeyListResponse {
  total_count: number;
  entries: RedisKeyEntry[];
}

export type RedisKeyValue =
  | { kind: "string"; value: string; truncated: boolean; size: number }
  | { kind: "hash"; entries: Array<[string, string]>; truncated: boolean; length: number }
  | { kind: "list"; items: string[]; truncated: boolean; length: number }
  | { kind: "set"; members: string[]; truncated: boolean; length: number }
  | { kind: "zset"; entries: Array<[string, number]>; truncated: boolean; length: number }
  | { kind: "none"; value: null; truncated: false; size: 0 };

export interface RedisKeyValueResponse {
  key: string;
  key_type: string;
  ttl: number;
  value: RedisKeyValue;
}
