export function formatStorageBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || isNaN(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

export function getFolderTypeBadgeLabel(
  folderType: string | null | undefined,
): string {
  switch (folderType) {
    case 'source':
      return 'Thư mục nguồn';
    case 'deliverable':
      return 'Thư mục thành phẩm';
    case 'root':
      return 'Thư mục gốc';
    default:
      return folderType || 'Khác';
  }
}
