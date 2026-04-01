import { useState, useRef, useCallback } from 'react';
import type { FileEntry } from '../hooks/useSession';

interface FileTransferProps {
  files: FileEntry[];
  onSendFile: (file: File) => void;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export default function FileTransfer({
  files,
  onSendFile,
  disabled,
}: FileTransferProps) {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (disabled) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
      droppedFiles.forEach((file) => onSendFile(file));
    },
    [disabled, onSendFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files;
      if (!selected) return;
      Array.from(selected).forEach((file) => onSendFile(file));
      // Reset the input so the same file can be selected again
      e.target.value = '';
    },
    [onSendFile],
  );

  const handleClick = useCallback(() => {
    if (!disabled) {
      fileInputRef.current?.click();
    }
  }, [disabled]);

  return (
    <div className="file-transfer">
      <div className="file-transfer-header">
        <span>Files</span>
        <span style={{ fontSize: '11px', fontWeight: 400 }}>
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div
        className={`file-drop-zone ${dragOver ? 'drag-over' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
        role="button"
        tabIndex={0}
      >
        <div className="drop-icon">{'\uD83D\uDCC1'}</div>
        <p>
          {disabled
            ? 'Connect to transfer files'
            : 'Drop files here or click to browse'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
      </div>
      {files.length > 0 && (
        <div className="file-list">
          {files.map((file) => (
            <div key={file.id} className="file-item">
              <span style={{ fontSize: '16px', flexShrink: 0 }}>
                {file.direction === 'upload' ? '\u2B06' : '\u2B07'}
              </span>
              <span className="file-name">
                {file.url ? (
                  <a
                    href={file.url}
                    download={file.name}
                    style={{ color: 'var(--accent)' }}
                  >
                    {file.name}
                  </a>
                ) : (
                  file.name
                )}
              </span>
              <span className="file-size">{formatFileSize(file.size)}</span>
              {file.complete && (
                <span style={{ color: 'var(--success)', fontSize: '14px' }}>
                  {'\u2713'}
                </span>
              )}
              {!file.complete && (
                <div className="file-progress" style={{ width: 60 }}>
                  <div
                    className="file-progress-bar"
                    style={{ width: `${Math.round(file.progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
