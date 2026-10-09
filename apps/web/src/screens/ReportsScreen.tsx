import React, { useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  EmptyState,
  EyeIcon,
  FileTextIcon,
  InfoIcon,
  PlusIcon,
} from '@management-lite/ui/components';

export const ReportsScreen: React.FC = () => {
  const [viewMode, setViewMode] = useState<'list' | 'empty'>('list');

  const mockReports = [
    {
      id: 'REP-001',
      date: '08/10/2026',
      author: 'Nguyễn Văn A (Staff)',
      status: 'submitted' as const,
      revision: 'v2 (C02 revision)',
      itemsCount: 3,
      summary:
        'Hoàn thành dựng 2 video ngắn và kiểm duyệt 1 kịch bản nội dung.',
    },
    {
      id: 'REP-002',
      date: '07/10/2026',
      author: 'Trần Thị B (Staff)',
      status: 'submitted' as const,
      revision: 'v1 (Gốc)',
      itemsCount: 4,
      summary: 'Đã hoàn tất biên tập âm thanh và xuất file hoàn chỉnh.',
    },
  ];

  return (
    <div>
      <PageHeader
        title="Báo cáo công việc hàng ngày"
        subtitle="Danh sách báo cáo công việc nhân viên (UI08)"
        badge={<StatusBadge status="neutral" label="UI08 DEMO" />}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <AppButton
              variant="secondary"
              onClick={() =>
                setViewMode(viewMode === 'list' ? 'empty' : 'list')
              }
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {viewMode === 'list' ? (
                <EyeIcon size={16} />
              ) : (
                <FileTextIcon size={16} />
              )}
              <span>
                {viewMode === 'list' ? 'Xem Empty State' : 'Xem Danh sách'}
              </span>
            </AppButton>
          </div>
        }
      />

      <div
        style={{
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: 'rgba(20, 184, 166, 0.1)',
          border: '1px solid rgba(20, 184, 166, 0.3)',
          marginBottom: '24px',
          fontSize: '13px',
          color: '#F8FAFC',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <InfoIcon size={20} style={{ color: '#14B8A6' }} />
        <div>
          <strong>QUY TẮC C02:</strong> Nhân viên sau khi nộp báo cáo
          (submitted) có thể nộp phiên bản chỉnh sửa mới (revision). Phiên bản
          cũ vẫn được lưu trữ bất biến (immutable), có thời gian và người nộp rõ
          ràng.
        </div>
      </div>

      {viewMode === 'empty' ? (
        <EmptyState
          title="Chưa có báo cáo công việc nào"
          description="Hôm nay bạn chưa tạo báo cáo công việc. Bấm nút dưới để tạo bản nháp đầu tiên."
          icon={<FileTextIcon size={40} />}
          action={
            <AppButton
              variant="primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <PlusIcon size={16} />
              <span>Tạo báo cáo mới (UI09 demo)</span>
            </AppButton>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {mockReports.map((report) => (
            <AppCard key={report.id} padding="20px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '12px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: '16px',
                        color: '#F8FAFC',
                      }}
                    >
                      {report.id} — Ngày {report.date}
                    </span>
                    <StatusBadge status="success" label="Đã nộp (Submitted)" />
                  </div>
                  <div
                    style={{
                      fontSize: '13px',
                      color: '#94A3B8',
                      marginTop: '2px',
                    }}
                  >
                    Người nộp: {report.author} | Phiên bản:{' '}
                    <strong style={{ color: '#14B8A6' }}>
                      {report.revision}
                    </strong>
                  </div>
                </div>

                <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                  {report.itemsCount} đầu mục công việc
                </div>
              </div>

              <p
                style={{
                  fontSize: '14px',
                  color: '#F8FAFC',
                  lineHeight: 1.5,
                  margin: '8px 0 16px 0',
                }}
              >
                {report.summary}
              </p>

              <div style={{ display: 'flex', gap: '8px' }}>
                <AppButton
                  variant="secondary"
                  style={{
                    fontSize: '13px',
                    minHeight: '36px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <FileTextIcon size={14} />
                  <span>Xem chi tiết & Lịch sử phiên bản (UI10)</span>
                </AppButton>
              </div>
            </AppCard>
          ))}
        </div>
      )}
    </div>
  );
};
