/**
 * Google Drive Storage Provider Abstraction (FILE-01 / Canonical STORAGE)
 *
 * Enforces zero-binary transfer through the server:
 * Lite server only handles metadata, revisions, receipts, and permissions.
 * File binaries are transferred directly between client and Google Drive.
 */

export interface StorageProviderResult {
  success: boolean;
  status: 'completed' | 'failed' | 'unknown';
  providerOperationId?: string | undefined;
  errorMessage?: string | undefined;
}

export interface IStorageProvider {
  trashFolder(providerFolderId?: string | null): Promise<StorageProviderResult>;
  restoreFolder(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult>;
  parseFolderId(driveUrl: string): string | null;
  reconcileFolderStatus?(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult>;
}

export class MockGoogleDriveProvider implements IStorageProvider {
  public trashedFolders = new Set<string>();
  private folderOverrides = new Map<string, StorageProviderResult>();

  private reconcileOverrides = new Map<string, StorageProviderResult>();

  /**
   * Test hook: inject custom result (e.g. failure, timeout/unknown) for a specific providerFolderId.
   */
  public overrideFolderResult(folderId: string, result: StorageProviderResult): void {
    this.folderOverrides.set(folderId, result);
  }

  public overrideReconcileResult(folderId: string, result: StorageProviderResult): void {
    this.reconcileOverrides.set(folderId, result);
  }

  public clearOverrides(): void {
    this.folderOverrides.clear();
    this.reconcileOverrides.clear();
    this.trashedFolders.clear();
  }

  async reconcileFolderStatus(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult> {
    const key = providerFolderId ?? 'unknown-folder';
    if (this.reconcileOverrides.has(key)) {
      return this.reconcileOverrides.get(key)!;
    }
    const isTrashed = this.trashedFolders.has(key);
    return {
      success: isTrashed,
      status: isTrashed ? 'completed' : 'failed',
      providerOperationId: `mock-reconcile-${Date.now()}`,
    };
  }

  async trashFolder(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult> {
    const key = providerFolderId ?? 'unknown-folder';

    if (this.folderOverrides.has(key)) {
      const override = this.folderOverrides.get(key)!;
      if (override.status === 'completed') {
        this.trashedFolders.add(key);
      }
      return override;
    }

    // Default mock success
    this.trashedFolders.add(key);
    return {
      success: true,
      status: 'completed',
      providerOperationId: `mock-drive-op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  async restoreFolder(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult> {
    const key = providerFolderId ?? 'unknown-folder';
    this.trashedFolders.delete(key);
    return {
      success: true,
      status: 'completed',
      providerOperationId: `mock-drive-restore-${Date.now()}`,
    };
  }

  parseFolderId(driveUrl: string): string | null {
    if (!driveUrl || typeof driveUrl !== 'string') return null;
    const match = driveUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    const idMatch = driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
      return idMatch[1];
    }
    return null;
  }
}
