import { useState, useCallback, type FormEvent } from 'react';
import { SESSION_CODE_LENGTH } from '../../../packages/shared/src';

interface SessionConnectProps {
  onConnect: (code: string) => void;
  error?: string | null;
  loading?: boolean;
}

export default function SessionConnect({
  onConnect,
  error,
  loading,
}: SessionConnectProps) {
  const [code, setCode] = useState('');

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, SESSION_CODE_LENGTH);
      setCode(val);
    },
    [],
  );

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (code.length === SESSION_CODE_LENGTH) {
        onConnect(code);
      }
    },
    [code, onConnect],
  );

  return (
    <form className="connect-form" onSubmit={handleSubmit}>
      <input
        type="text"
        value={code}
        onChange={handleChange}
        placeholder="ABC123"
        maxLength={SESSION_CODE_LENGTH}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        disabled={loading}
      />
      <button
        type="submit"
        className="btn btn-primary"
        disabled={code.length !== SESSION_CODE_LENGTH || loading}
      >
        {loading ? (
          <span className="spinner" />
        ) : (
          'Connect'
        )}
      </button>
      {error && (
        <div
          style={{
            position: 'absolute',
            marginTop: '60px',
            color: 'var(--danger)',
            fontSize: '13px',
            textAlign: 'center',
            width: '100%',
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
