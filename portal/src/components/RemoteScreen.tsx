import { useRef, useEffect, useCallback, useState } from 'react';
import type { RemoteInput } from '../../../packages/shared/src';

interface RemoteScreenProps {
  stream: MediaStream | null;
  onInput: (input: RemoteInput) => void;
  rtcState: string;
}

export default function RemoteScreen({
  stream,
  onInput,
  rtcState,
}: RemoteScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Attach stream to video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      video.play().catch(() => {});
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  // Listen for fullscreen changes
  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Compute coordinates relative to the video's rendered area
  const getVideoCoords = useCallback(
    (clientX: number, clientY: number) => {
      const video = videoRef.current;
      if (!video) return null;

      const rect = video.getBoundingClientRect();
      const videoWidth = video.videoWidth || 1920;
      const videoHeight = video.videoHeight || 1080;

      // Account for object-fit: contain
      const videoAspect = videoWidth / videoHeight;
      const rectAspect = rect.width / rect.height;

      let renderWidth: number;
      let renderHeight: number;
      let offsetX: number;
      let offsetY: number;

      if (rectAspect > videoAspect) {
        // Pillarboxed (bars on left/right)
        renderHeight = rect.height;
        renderWidth = rect.height * videoAspect;
        offsetX = (rect.width - renderWidth) / 2;
        offsetY = 0;
      } else {
        // Letterboxed (bars on top/bottom)
        renderWidth = rect.width;
        renderHeight = rect.width / videoAspect;
        offsetX = 0;
        offsetY = (rect.height - renderHeight) / 2;
      }

      const relX = clientX - rect.left - offsetX;
      const relY = clientY - rect.top - offsetY;

      // Out of bounds check
      if (relX < 0 || relX > renderWidth || relY < 0 || relY > renderHeight) {
        return null;
      }

      return {
        x: Math.round((relX / renderWidth) * videoWidth),
        y: Math.round((relY / renderHeight) * videoHeight),
        screenWidth: videoWidth,
        screenHeight: videoHeight,
      };
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const coords = getVideoCoords(e.clientX, e.clientY);
      if (!coords) return;
      onInput({
        action: 'mouse_move',
        ...coords,
      });
    },
    [getVideoCoords, onInput],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const coords = getVideoCoords(e.clientX, e.clientY);
      if (!coords) return;
      const button = (['left', 'middle', 'right'] as const)[e.button] || 'left';
      onInput({
        action: 'mouse_click',
        ...coords,
        button,
        clickType: 'down',
      });
    },
    [getVideoCoords, onInput],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const coords = getVideoCoords(e.clientX, e.clientY);
      if (!coords) return;
      const button = (['left', 'middle', 'right'] as const)[e.button] || 'left';
      onInput({
        action: 'mouse_click',
        ...coords,
        button,
        clickType: 'up',
      });
    },
    [getVideoCoords, onInput],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const coords = getVideoCoords(e.clientX, e.clientY);
      if (!coords) return;
      onInput({
        action: 'mouse_click',
        ...coords,
        button: 'left',
        clickType: 'dblclick',
      });
    },
    [getVideoCoords, onInput],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const coords = getVideoCoords(e.clientX, e.clientY);
      if (!coords) return;
      onInput({
        action: 'mouse_scroll',
        ...coords,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      });
    },
    [getVideoCoords, onInput],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // Keyboard events
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Prevent browser default for keys like Tab, F5, etc.
      if (
        e.key === 'Tab' ||
        e.key === 'F5' ||
        (e.ctrlKey && ['r', 'w', 't', 'n', 'l'].includes(e.key))
      ) {
        e.preventDefault();
      }
      onInput({
        action: 'key',
        key: e.key,
        code: e.code,
        keyType: 'down',
        modifiers: {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
        },
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      onInput({
        action: 'key',
        key: e.key,
        code: e.code,
        keyType: 'up',
        modifiers: {
          ctrl: e.ctrlKey,
          alt: e.altKey,
          shift: e.shiftKey,
          meta: e.metaKey,
        },
      });
    };

    wrapper.addEventListener('keydown', handleKeyDown);
    wrapper.addEventListener('keyup', handleKeyUp);
    return () => {
      wrapper.removeEventListener('keydown', handleKeyDown);
      wrapper.removeEventListener('keyup', handleKeyUp);
    };
  }, [onInput]);

  const toggleFullscreen = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      el.requestFullscreen();
    }
  }, []);

  const hasStream = !!stream;
  const isConnecting = rtcState === 'connecting' || rtcState === 'new';

  return (
    <div
      className="remote-screen-wrapper"
      ref={wrapperRef}
      tabIndex={0}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
      style={{ cursor: hasStream ? 'none' : 'default' }}
    >
      {hasStream ? (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={false}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
          />
          <button
            className="btn-icon fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 10,
              opacity: 0.7,
            }}
          >
            {isFullscreen ? '\u2716' : '\u26F6'}
          </button>
        </>
      ) : (
        <div className="remote-screen-placeholder">
          <div className="placeholder-icon">
            {isConnecting ? (
              <span className="spinner" />
            ) : (
              '\uD83D\uDDA5'
            )}
          </div>
          <span>
            {rtcState === 'failed'
              ? 'Connection failed'
              : rtcState === 'disconnected' || rtcState === 'closed'
                ? 'Disconnected'
                : 'Waiting for remote screen...'}
          </span>
          {isConnecting && (
            <span
              className="connection-pulse"
              style={{ background: 'var(--accent)' }}
            />
          )}
        </div>
      )}
    </div>
  );
}
