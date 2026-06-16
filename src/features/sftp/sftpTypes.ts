export interface SftpEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "unknown";
  size: number;
  modified_at?: string;
  permissions?: string;
}
