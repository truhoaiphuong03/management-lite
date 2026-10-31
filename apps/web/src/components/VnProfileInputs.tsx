import React, { useEffect, useRef, useState } from 'react';

export interface VnBankOption {
  shortName: string;
  code: string;
  fullName: string;
}

export const VN_BANKS: VnBankOption[] = [
  { shortName: 'MB Bank', code: 'MB', fullName: 'Ngân hàng Quân Đội (MB Bank)' },
  { shortName: 'Vietcombank', code: 'VCB', fullName: 'Ngân hàng Ngoại Thương Việt Nam (VCB)' },
  { shortName: 'Techcombank', code: 'TCB', fullName: 'Ngân hàng Kỹ Thương Việt Nam (TCB)' },
  { shortName: 'VietinBank', code: 'CTG', fullName: 'Ngân hàng Công Thương Việt Nam (VietinBank)' },
  { shortName: 'BIDV', code: 'BIDV', fullName: 'Ngân hàng Đầu tư và Phát triển Việt Nam (BIDV)' },
  { shortName: 'ACB', code: 'ACB', fullName: 'Ngân hàng Á Châu (ACB)' },
  { shortName: 'Agribank', code: 'VBA', fullName: 'Ngân hàng NN & PTNT Việt Nam (Agribank)' },
  { shortName: 'VPBank', code: 'VPB', fullName: 'Ngân hàng Việt Nam Thịnh Vượng (VPBank)' },
  { shortName: 'TPBank', code: 'TPB', fullName: 'Ngân hàng Tiên Phong (TPBank)' },
  { shortName: 'Sacombank', code: 'STB', fullName: 'Ngân hàng Sài Gòn Thương Tín (Sacombank)' },
  { shortName: 'VIB', code: 'VIB', fullName: 'Ngân hàng Quốc Tế (VIB)' },
  { shortName: 'HDBank', code: 'HDB', fullName: 'Ngân hàng Phát triển TP.HCM (HDBank)' },
  { shortName: 'SHB', code: 'SHB', fullName: 'Ngân hàng Sài Gòn - Hà Nội (SHB)' },
  { shortName: 'MSB', code: 'MSB', fullName: 'Ngân hàng Hàng Hải Việt Nam (MSB)' },
  { shortName: 'OCB', code: 'OCB', fullName: 'Ngân hàng Phương Đông (OCB)' },
  { shortName: 'SeABank', code: 'SSB', fullName: 'Ngân hàng Đông Nam Á (SeABank)' },
  { shortName: 'LPBank', code: 'LPB', fullName: 'Ngân hàng Lộc Phát Việt Nam (LPBank)' },
  { shortName: 'Eximbank', code: 'EIB', fullName: 'Ngân hàng Xuất Nhập Khẩu Việt Nam (Eximbank)' },
  { shortName: 'BVBank', code: 'BVB', fullName: 'Ngân hàng Bản Việt (BVBank / Timo)' },
  { shortName: 'Cake by VPBank', code: 'CAKE', fullName: 'Ngân hàng số Cake by VPBank' },
  { shortName: 'Nam A Bank', code: 'NAB', fullName: 'Ngân hàng Nam Á (Nam A Bank)' },
  { shortName: 'PVcomBank', code: 'PVC', fullName: 'Ngân hàng Đại Chúng Việt Nam (PVcomBank)' },
  { shortName: 'Bac A Bank', code: 'BAB', fullName: 'Ngân hàng Bắc Á (Bac A Bank)' },
  { shortName: 'VietABank', code: 'VAB', fullName: 'Ngân hàng Việt Á (VietABank)' },
  { shortName: 'VietBank', code: 'VBB', fullName: 'Ngân hàng Việt Nam Thương Tín (VietBank)' },
  { shortName: 'KienlongBank', code: 'KLB', fullName: 'Ngân hàng Kiên Long (KienlongBank)' },
  { shortName: 'NCB', code: 'NCB', fullName: 'Ngân hàng Quốc Dân (NCB)' },
  { shortName: 'PGBank', code: 'PGB', fullName: 'Ngân hàng Thịnh Vượng và Phát Triển (PGBank)' },
  { shortName: 'Saigonbank', code: 'SGB', fullName: 'Ngân hàng Sài Gòn Công Thương (Saigonbank)' },
  { shortName: 'BaoVietBank', code: 'BVB', fullName: 'Ngân hàng Bảo Việt (BaoVietBank)' },
  { shortName: 'Shinhan Bank', code: 'SHBVN', fullName: 'Ngân hàng Shinhan Việt Nam' },
  { shortName: 'Woori Bank', code: 'WVN', fullName: 'Ngân hàng Woori Việt Nam' },
  { shortName: 'HSBC', code: 'HSBC', fullName: 'Ngân hàng HSBC Việt Nam' },
  { shortName: 'UOB', code: 'UOB', fullName: 'Ngân hàng UOB Việt Nam' },
];

export interface VnDateOfBirthSelectProps {
  id?: string;
  testId?: string;
  value: string;
  onChange: (isoDate: string) => void;
}

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 75 }, (_, i) => String(CURRENT_YEAR - 14 - i));

export const VnDateOfBirthSelect: React.FC<VnDateOfBirthSelectProps> = ({
  id,
  testId,
  value,
  onChange,
}) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  const [day, setDay] = useState<string>(parts?.[3] || '');
  const [month, setMonth] = useState<string>(parts?.[2] || '');
  const [year, setYear] = useState<string>(parts?.[1] || '');

  useEffect(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
    if (m) {
      setYear(m[1] || '');
      setMonth(m[2] || '');
      setDay(m[3] || '');
    } else if (!value) {
      setYear('');
      setMonth('');
      setDay('');
    }
  }, [value]);

  const handlePartChange = (nextDay: string, nextMonth: string, nextYear: string) => {
    setDay(nextDay);
    setMonth(nextMonth);
    setYear(nextYear);
    if (nextDay && nextMonth && nextYear) {
      onChange(`${nextYear}-${nextMonth}-${nextDay}`);
    } else if (!nextDay && !nextMonth && !nextYear) {
      onChange('');
    }
  };

  const selectStyle: React.CSSProperties = {
    width: '100%',
    height: '40px',
    boxSizing: 'border-box',
    padding: '0 8px',
    fontSize: '13.5px',
    borderRadius: '8px',
    border: '1px solid #475569',
    backgroundColor: '#1E293B',
    color: '#F8FAFC',
    cursor: 'pointer',
  };

  return (
    <div
      id={id}
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1.1fr 1.1fr',
        gap: '6px',
        marginTop: '4px',
      }}
    >
      <select
        aria-label="Ngày sinh"
        data-testid={testId ? `${testId}-day` : undefined}
        value={day}
        onChange={(e) => handlePartChange(e.target.value, month, year)}
        style={selectStyle}
      >
        <option value="">Ngày</option>
        {DAYS.map((d) => (
          <option key={d} value={d}>
            Ngày {d}
          </option>
        ))}
      </select>

      <select
        aria-label="Tháng sinh"
        data-testid={testId ? `${testId}-month` : undefined}
        value={month}
        onChange={(e) => handlePartChange(day, e.target.value, year)}
        style={selectStyle}
      >
        <option value="">Tháng</option>
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            Tháng {m}
          </option>
        ))}
      </select>

      <select
        aria-label="Năm sinh"
        data-testid={testId ? `${testId}-year` : undefined}
        value={year}
        onChange={(e) => handlePartChange(day, month, e.target.value)}
        style={selectStyle}
      >
        <option value="">Năm</option>
        {YEARS.map((y) => (
          <option key={y} value={y}>
            Năm {y}
          </option>
        ))}
      </select>
    </div>
  );
};

export interface VnBankAutocompleteInputProps {
  id?: string;
  testId?: string;
  value: string;
  onChange: (bankName: string) => void;
  placeholder?: string;
}

export const VnBankAutocompleteInput: React.FC<VnBankAutocompleteInputProps> = ({
  id,
  testId,
  value,
  onChange,
  placeholder = '🔍 Tìm tên ngân hàng (VD: MB, VCB, Techcombank...)',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const query = (value || '').trim().toLowerCase();
  const filteredBanks = VN_BANKS.filter((b) => {
    if (!query) return true;
    return (
      b.shortName.toLowerCase().includes(query) ||
      b.code.toLowerCase().includes(query) ||
      b.fullName.toLowerCase().includes(query)
    );
  });

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      <input
        id={id}
        data-testid={testId}
        type="text"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        placeholder={placeholder}
        autoComplete="off"
        style={{
          width: '100%',
          height: '38px',
          boxSizing: 'border-box',
          padding: '0 12px',
          fontSize: '13.5px',
          borderRadius: '8px',
          border: '1px solid #475569',
          backgroundColor: '#1E293B',
          color: '#F8FAFC',
        }}
      />
      {open && filteredBanks.length > 0 && (
        <div
          data-testid="bank-autocomplete-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            minWidth: '100%',
            maxWidth: 'calc(100vw - 40px)',
            maxHeight: '210px',
            overflowY: 'auto',
            backgroundColor: '#0F172A',
            border: '1px solid #14B8A6',
            borderRadius: '8px',
            boxShadow: '0 12px 28px rgba(0, 0, 0, 0.65)',
            zIndex: 1200,
          }}
        >
          {filteredBanks.map((bank) => (
            <button
              key={`${bank.code}-${bank.shortName}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(bank.shortName);
                setOpen(false);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                border: 'none',
                borderBottom: '1px solid #1E293B',
                backgroundColor:
                  value === bank.shortName
                    ? 'rgba(20, 184, 166, 0.18)'
                    : 'transparent',
                color: '#F8FAFC',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
            >
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#38BDF8' }}>
                {bank.shortName}{' '}
                <span style={{ fontSize: '11px', color: '#94A3B8', fontWeight: 500 }}>
                  ({bank.code})
                </span>
              </div>
              <div style={{ fontSize: '11px', color: '#CBD5E1' }}>
                {bank.fullName}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
