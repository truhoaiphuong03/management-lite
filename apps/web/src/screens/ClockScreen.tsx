import React, { useState, useEffect } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  AlertTriangleIcon,
  PlayIcon,
  PauseIcon,
  StopIcon,
  RotateCcwIcon,
} from '@management-lite/ui/components';

type ShiftState = 'idle' | 'working' | 'paused' | 'completed';

export const ClockScreen: React.FC = () => {
  const [shiftState, setShiftState] = useState<ShiftState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const [lastActionNote, setLastActionNote] = useState<string>(
    'Chưa bắt đầu ca làm',
  );

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (shiftState === 'working') {
      interval = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    } else if (shiftState === 'paused') {
      interval = setInterval(() => {
        setBreakSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [shiftState]);

  const formatTime = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleClockIn = () => {
    setShiftState('working');
    setLastActionNote(`Vào ca lúc ${new Date().toLocaleTimeString('vi-VN')}`);
  };

  const handlePause = () => {
    setShiftState('paused');
    setLastActionNote(
      `Tạm nghỉ lúc ${new Date().toLocaleTimeString('vi-VN')} (nghỉ không tính công theo PAY-02)`,
    );
  };

  const handleResume = () => {
    setShiftState('working');
    setLastActionNote(
      `Tiếp tục làm việc lúc ${new Date().toLocaleTimeString('vi-VN')}`,
    );
  };

  const handleClockOut = () => {
    setShiftState('completed');
    setLastActionNote(
      `Kết thúc ca lúc ${new Date().toLocaleTimeString('vi-VN')} (chờ Owner duyệt theo UI07)`,
    );
  };

  const handleResetDemo = () => {
    setShiftState('idle');
    setSeconds(0);
    setBreakSeconds(0);
    setLastActionNote('Đã đặt lại trạng thái demo');
  };

  return (
    <div>
      <PageHeader
        title="Chấm công ca làm"
        subtitle="Mô phỏng quy trình chấm công thời gian thực (UI04)"
        badge={
          <StatusBadge
            status={
              shiftState === 'working'
                ? 'success'
                : shiftState === 'paused'
                  ? 'warning'
                  : shiftState === 'completed'
                    ? 'muted'
                    : 'neutral'
            }
            label={
              shiftState === 'working'
                ? 'Đang làm việc'
                : shiftState === 'paused'
                  ? 'Đang tạm nghỉ'
                  : shiftState === 'completed'
                    ? 'Đã kết thúc ca'
                    : 'Chưa vào ca'
            }
          />
        }
      />

      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          marginBottom: '24px',
          fontSize: '13px',
          color: '#F59E0B',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <AlertTriangleIcon size={18} />
        <div>
          <strong>MÔ PHỎNG NON-PERSISTENT (FT-01 DEMO):</strong> Trạng thái chấm
          công dưới đây chỉ lưu tạm trong bộ nhớ trình duyệt, không gọi API hay
          ghi vào bảng `attendance_shifts`.
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '20px',
          marginBottom: '24px',
        }}
      >
        {/* Main Clock Card */}
        <AppCard
          padding="24px"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <div
            style={{ fontSize: '14px', color: '#94A3B8', marginBottom: '8px' }}
          >
            Thời gian làm việc tính công (giờ:phút:giây)
          </div>
          <div
            style={{
              fontSize: '48px',
              fontWeight: 800,
              fontFamily: 'monospace',
              color: '#14B8A6',
              letterSpacing: '2px',
              margin: '12px 0',
            }}
          >
            {formatTime(seconds)}
          </div>

          {shiftState === 'paused' && (
            <div
              style={{
                fontSize: '14px',
                color: '#F59E0B',
                marginBottom: '16px',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                padding: '6px 12px',
                borderRadius: '6px',
              }}
            >
              Thời gian tạm nghỉ (unpaid):{' '}
              <strong>{formatTime(breakSeconds)}</strong>
            </div>
          )}

          <div
            style={{ fontSize: '13px', color: '#94A3B8', marginBottom: '24px' }}
          >
            {lastActionNote}
          </div>

          {/* Action buttons */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px',
              justifyContent: 'center',
              width: '100%',
              maxWidth: '360px',
            }}
          >
            {shiftState === 'idle' && (
              <AppButton
                variant="primary"
                fullWidth
                onClick={handleClockIn}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  justifyContent: 'center',
                }}
              >
                <PlayIcon size={16} />
                <span>Vào ca (Clock-In)</span>
              </AppButton>
            )}

            {shiftState === 'working' && (
              <>
                <AppButton
                  variant="secondary"
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'center',
                  }}
                  onClick={handlePause}
                >
                  <PauseIcon size={16} />
                  <span>Tạm nghỉ</span>
                </AppButton>
                <AppButton
                  variant="destructive"
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'center',
                  }}
                  onClick={handleClockOut}
                >
                  <StopIcon size={16} />
                  <span>Hết ca</span>
                </AppButton>
              </>
            )}

            {shiftState === 'paused' && (
              <>
                <AppButton
                  variant="primary"
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'center',
                  }}
                  onClick={handleResume}
                >
                  <PlayIcon size={16} />
                  <span>Tiếp tục làm</span>
                </AppButton>
                <AppButton
                  variant="destructive"
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    justifyContent: 'center',
                  }}
                  onClick={handleClockOut}
                >
                  <StopIcon size={16} />
                  <span>Hết ca</span>
                </AppButton>
              </>
            )}

            {shiftState === 'completed' && (
              <AppButton
                variant="secondary"
                fullWidth
                onClick={handleResetDemo}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  justifyContent: 'center',
                }}
              >
                <RotateCcwIcon size={16} />
                <span>Đặt lại demo ca mới</span>
              </AppButton>
            )}
          </div>
        </AppCard>

        {/* Invariants & Rules Card */}
        <AppCard padding="24px">
          <h3
            style={{
              fontSize: '16px',
              fontWeight: 600,
              marginBottom: '12px',
              color: '#F8FAFC',
            }}
          >
            Quy tắc chấm công V0.1 (Canonical ATT/PAY-02)
          </h3>
          <ul
            style={{
              paddingLeft: '20px',
              fontSize: '13px',
              color: '#94A3B8',
              lineHeight: 1.8,
            }}
          >
            <li>
              <strong>Không đoán giờ tan ca:</strong> Bắt buộc bấm kết thúc ca
              hoặc nộp đơn giải trình C01 nếu quên.
            </li>
            <li>
              <strong>Nghỉ giữa ca không tính lương:</strong> Thời gian break
              được tách biệt chính xác từng giây.
            </li>
            <li>
              <strong>Bất biến ca đã đóng:</strong> Khi hết ca, ca làm tạo
              snapshot immutable version chờ Owner duyệt.
            </li>
            <li>
              <strong>Quy tắc C01:</strong> Quên bấm hết ca cần tạo yêu cầu giải
              trình có lý do; Owner quyết định giờ tan ca rõ ràng.
            </li>
          </ul>
        </AppCard>
      </div>
    </div>
  );
};
