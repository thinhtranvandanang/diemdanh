import React, { useState, useEffect, useCallback } from 'react';
import {
  FileSpreadsheet,
  Calendar,
  CheckCircle2,
  XCircle,
  ClockAlert,
  Save,
  RotateCw,
  Users,
  Check,
  Info,
  School,
  ExternalLink,
  Loader2,
  LogOut,
  UserCheck,
  Share2,
  Copy,
  AlertTriangle,
  X,
  Mail,
  Lock,
  ShieldCheck
} from 'lucide-react';
import type { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout } from './services/auth.ts';
import {
  getOrCreateAttendanceSpreadsheet,
  saveAttendanceRecords,
  loadAttendanceByDate,
  grantLinkEditPermission,
  shareWithEmail,
  shareWithDomain,
  SpreadsheetInfo
} from './services/sheets.ts';

type AttendanceStatus = 'present' | 'absent' | 'excused';

interface Student {
  id: string;
  code: string;
  name: string;
  status: AttendanceStatus;
  note: string;
}

// 5 sinh viên mẫu ẩn danh ban đầu (mặc định tất cả Có mặt)
const INITIAL_STUDENTS: Student[] = [
  { id: '1', code: 'SV01', name: 'Sinh viên A', status: 'present', note: '' },
  { id: '2', code: 'SV02', name: 'Sinh viên B', status: 'present', note: '' },
  { id: '3', code: 'SV03', name: 'Sinh viên C', status: 'present', note: '' },
  { id: '4', code: 'SV04', name: 'Sinh viên D', status: 'present', note: '' },
  { id: '5', code: 'SV05', name: 'Sinh viên E', status: 'present', note: '' },
];

export default function App() {
  // Dữ liệu sinh viên hiển thị trong bảng
  const [students, setStudents] = useState<Student[]>(INITIAL_STUDENTS);

  // Trạng thái ngày học
  const [selectedDate, setSelectedDate] = useState<string>('2026-11-05');

  // Trạng thái xác thực & bảng tính Google Sheets
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState<boolean>(false);
  const [spreadsheetInfo, setSpreadsheetInfo] = useState<SpreadsheetInfo | null>(null);
  const [isSpreadsheetLoading, setIsSpreadsheetLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);

  // Trạng thái lỗi phân quyền dùng chung (khi tài khoản khác chưa được cấp quyền Editor)
  const [permissionError, setPermissionError] = useState<string | null>(null);

  // Hộp thoại chia sẻ bảng tính
  const [showShareModal, setShowShareModal] = useState<boolean>(false);
  const [shareEmailInput, setShareEmailInput] = useState<string>('');
  const [isSharing, setIsSharing] = useState<boolean>(false);

  // Toast thông báo
  const [activeToast, setActiveToast] = useState<{ text: string; type?: 'info' | 'success' | 'error' } | null>(null);

  const showToast = (text: string, type: 'info' | 'success' | 'error' = 'info') => {
    setActiveToast({ text, type });
    setTimeout(() => setActiveToast(null), 4000);
  };

  // Tải dữ liệu điểm danh theo ngày đã chọn từ bảng tính
  const fetchAttendanceForDate = useCallback(async (token: string, sheetId: string, date: string, isSilent = false) => {
    setIsLoadingData(true);
    try {
      const recordsMap = await loadAttendanceByDate(token, sheetId, date);
      if (recordsMap.size > 0) {
        setStudents(prev =>
          prev.map(student => {
            const matched = recordsMap.get(student.code.toLowerCase());
            if (matched) {
              return {
                ...student,
                status: matched.status,
                note: matched.note || '',
              };
            }
            // Nếu sinh viên chưa có dòng trong ngày này -> Mặc định là "Có mặt"
            return {
              ...student,
              status: 'present',
              note: '',
            };
          })
        );
        if (!isSilent) {
          showToast(`Đã tải dữ liệu điểm danh ngày ${date} từ bảng tính`, 'success');
        }
      } else {
        // Ngày chưa có dữ liệu thì để trạng thái mặc định là "Có mặt"
        setStudents(prev =>
          prev.map(student => ({
            ...student,
            status: 'present',
            note: '',
          }))
        );
        if (!isSilent) {
          showToast(`Ngày ${date} chưa có dữ liệu điểm danh (đã đặt mặc định Có mặt)`, 'info');
        }
      }
    } catch (err: any) {
      console.error('Lỗi tải dữ liệu điểm danh:', err);
      if (!isSilent) {
        showToast('Lỗi khi tải dữ liệu từ bảng tính: ' + (err.message || 'Lỗi kết nối'), 'error');
      }
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // Xử lý tìm hoặc kết nối bảng tính "Sổ điểm danh" dùng chung
  const handleFetchSpreadsheet = useCallback(async (token: string, userEmail?: string | null) => {
    setIsSpreadsheetLoading(true);
    setPermissionError(null);
    try {
      const sheet = await getOrCreateAttendanceSpreadsheet(token, userEmail || currentUser?.email);
      setSpreadsheetInfo(sheet);
      if (sheet.isNewlyCreated) {
        showToast('Đã tạo bảng tính "Sổ điểm danh" dùng chung cho mọi tài khoản', 'success');
        setStudents(prev => prev.map(s => ({ ...s, status: 'present', note: '' })));
      } else {
        showToast('Đã kết nối vào bảng tính dùng chung "Sổ điểm danh"', 'success');
        fetchAttendanceForDate(token, sheet.id, selectedDate, false);
      }
    } catch (err: any) {
      console.error('Lỗi khởi tạo bảng tính:', err);
      if (err.message && err.message.includes('chưa được cấp quyền')) {
        setPermissionError(err.message);
      }
      showToast(err.message || 'Không thể mở bảng tính Sổ điểm danh', 'error');
    } finally {
      setIsSpreadsheetLoading(false);
    }
  }, [currentUser?.email, fetchAttendanceForDate, selectedDate]);

  // Khởi tạo theo dõi trạng thái đăng nhập
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setAccessToken(token);
        handleFetchSpreadsheet(token, user.email);
      },
      () => {
        setCurrentUser(null);
        setAccessToken(null);
        setSpreadsheetInfo(null);
        setPermissionError(null);
      }
    );
    return () => unsubscribe();
  }, [handleFetchSpreadsheet]);

  // Đăng nhập Google
  const handleGoogleLogin = async () => {
    setIsAuthLoading(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setCurrentUser(result.user);
        setAccessToken(result.accessToken);
        await handleFetchSpreadsheet(result.accessToken, result.user.email);
      }
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        showToast('Đăng nhập Google thất bại: ' + (err.message || 'Vui lòng thử lại'), 'error');
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Đăng xuất Google
  const handleLogout = async () => {
    await logout();
    setCurrentUser(null);
    setAccessToken(null);
    setSpreadsheetInfo(null);
    setPermissionError(null);
    setStudents(INITIAL_STUDENTS);
    showToast('Đã đăng xuất Google', 'info');
  };

  // Xử lý khi đổi ngày học: tự động tải dữ liệu của ngày đó nếu có
  const handleDateChange = (newDate: string) => {
    setSelectedDate(newDate);
    if (accessToken && spreadsheetInfo) {
      fetchAttendanceForDate(accessToken, spreadsheetInfo.id, newDate, false);
    } else {
      // Khi chưa đăng nhập hoặc chưa kết nối, đặt mặc định là "Có mặt"
      setStudents(prev => prev.map(s => ({ ...s, status: 'present', note: '' })));
    }
  };

  // LƯU ĐIỂM DANH: Ghi trạng thái và ghi chú vào trang "DiemDanh" theo ngày đang chọn
  const handleSaveAttendance = async () => {
    if (!currentUser || !accessToken) {
      showToast('Vui lòng bấm "Đăng nhập Google" ở góc trên để lưu vào Google Sheets.', 'error');
      return;
    }

    if (!spreadsheetInfo) {
      showToast('Bảng tính chưa sẵn sàng, vui lòng thử lại sau vài giây.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      await saveAttendanceRecords(
        accessToken,
        spreadsheetInfo.id,
        selectedDate,
        students.map(s => ({
          code: s.code,
          name: s.name,
          status: s.status,
          note: s.note,
        }))
      );

      // Thông báo thành công
      showToast(`Đã lưu điểm danh ngày ${selectedDate}`, 'success');
    } catch (err: any) {
      console.error('Lỗi khi lưu điểm danh:', err);
      showToast(`Lỗi khi lưu điểm danh: ${err.message || 'Không thể ghi dữ liệu vào Google Sheets. Vui lòng kiểm tra quyền truy cập hoặc kết nối mạng.'}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // TẢI LẠI TỪ BẢNG TÍNH
  const handleReloadFromSpreadsheet = () => {
    if (!currentUser || !accessToken) {
      showToast('Vui lòng Đăng nhập Google để tải dữ liệu từ bảng tính', 'error');
      return;
    }
    if (!spreadsheetInfo) {
      handleFetchSpreadsheet(accessToken, currentUser.email);
      return;
    }
    fetchAttendanceForDate(accessToken, spreadsheetInfo.id, selectedDate, false);
  };

  // Cập nhật trạng thái sinh viên
  const handleStatusChange = (id: string, newStatus: AttendanceStatus) => {
    setStudents(prev =>
      prev.map(s => (s.id === id ? { ...s, status: newStatus } : s))
    );
  };

  // Cập nhật ghi chú
  const handleNoteChange = (id: string, newNote: string) => {
    setStudents(prev =>
      prev.map(s => (s.id === id ? { ...s, note: newNote } : s))
    );
  };

  // Đánh dấu tất cả có mặt nhanh
  const markAllPresent = () => {
    setStudents(prev => prev.map(s => ({ ...s, status: 'present' })));
    showToast('Đã chuyển nhanh toàn bộ 5 sinh viên sang "Có mặt"');
  };

  // Cấp quyền chia sẻ mở cho bất kỳ ai có liên kết
  const handleMakePublicEditable = async () => {
    if (!accessToken || !spreadsheetInfo) return;
    setIsSharing(true);
    try {
      await grantLinkEditPermission(accessToken, spreadsheetInfo.id);
      showToast('Đã mở quyền Chỉnh sửa cho bất kỳ ai có liên kết!', 'success');
    } catch (e: any) {
      showToast(e.message || 'Lỗi khi mở quyền chia sẻ', 'error');
    } finally {
      setIsSharing(false);
    }
  };

  // Cấp quyền chia sẻ cho toàn bộ tổ chức (ví dụ: fpt.edu.vn)
  const handleShareWithDomainMembers = async (domain: string) => {
    if (!accessToken || !spreadsheetInfo) return;
    setIsSharing(true);
    try {
      await shareWithDomain(accessToken, spreadsheetInfo.id, domain);
      showToast(`Đã mở quyền Chỉnh sửa cho toàn bộ giảng viên thuộc @${domain}!`, 'success');
    } catch (e: any) {
      showToast(e.message || 'Lỗi khi chia sẻ cho tổ chức', 'error');
    } finally {
      setIsSharing(false);
    }
  };

  // Cấp quyền chia sẻ cho email cụ thể
  const handleShareWithSpecificEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accessToken || !spreadsheetInfo || !shareEmailInput.trim()) return;
    setIsSharing(true);
    try {
      await shareWithEmail(accessToken, spreadsheetInfo.id, shareEmailInput.trim());
      showToast(`Đã cấp quyền chỉnh sửa cho ${shareEmailInput.trim()}`, 'success');
      setShareEmailInput('');
    } catch (e: any) {
      showToast(e.message || 'Lỗi chia sẻ email', 'error');
    } finally {
      setIsSharing(false);
    }
  };

  // Sao chép link ứng dụng có gắn ID bảng tính dùng chung
  const handleCopyShareLink = () => {
    if (!spreadsheetInfo) return;
    const shareUrl = `${window.location.origin}${window.location.pathname}?sheetId=${spreadsheetInfo.id}`;
    navigator.clipboard.writeText(shareUrl);
    showToast('Đã sao chép liên kết chia sẻ dùng chung vào bộ nhớ tạm!', 'success');
  };

  // Thống kê số lượng (chỉ hiển thị, không lưu vào bảng tính)
  const totalStudents = students.length;
  const countPresent = students.filter(s => s.status === 'present').length;
  const countAbsent = students.filter(s => s.status === 'absent').length;
  const countExcused = students.filter(s => s.status === 'excused').length;

  return (
    <div className="min-h-screen bg-white text-slate-800 font-sans selection:bg-blue-100 selection:text-blue-900 pb-16">
      {/* Thông báo thao tác */}
      {activeToast && (
        <div
          className={`fixed top-5 right-5 z-50 text-white px-5 py-3 rounded-lg shadow-xl border flex items-center gap-3 animate-fade-in text-base max-w-md ${
            activeToast.type === 'error'
              ? 'bg-red-800 border-red-600'
              : activeToast.type === 'success'
              ? 'bg-blue-900 border-blue-700'
              : 'bg-slate-900 border-slate-700'
          }`}
        >
          <Info className="w-5 h-5 text-blue-300 shrink-0" />
          <span>{activeToast.text}</span>
        </div>
      )}

      {/* BANNER TRẠNG THÁI */}
      <div className="bg-blue-50 border-b border-blue-200 text-blue-900 px-6 py-2.5 text-sm flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider">
            Dùng chung tập tin
          </span>
          <span>
            {currentUser
              ? `Tài khoản: ${currentUser.email || currentUser.displayName} • Đang kết nối bảng tính dùng chung "Sổ điểm danh"`
              : 'Chưa đăng nhập. Các tài khoản Gmail khi đăng nhập sẽ tự động dùng chung tập tin bảng tính.'}
          </span>
        </div>
        <div className="text-blue-700 hidden md:block text-xs">
          Nền trắng • Chữ lớn • Nút xanh dương
        </div>
      </div>

      {/* CẢNH BÁO PHÂN QUYỀN TRÊN BẢNG TÍNH DÙNG CHUNG */}
      {permissionError && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4 text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-base">Cần cấp quyền Người chỉnh sửa (Editor) trên Google Sheets</h4>
                <p className="text-sm text-amber-800 mt-0.5">
                  Tài khoản của bạn (<span className="font-bold underline">{currentUser?.email}</span>) chưa được cấp quyền Người chỉnh sửa.
                  Hãy nhờ chủ sở hữu mở bảng tính và thêm quyền Chỉnh sửa cho email này, hoặc bấm nút bên phải để gửi yêu cầu trực tiếp trên Google.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto flex-wrap">
              {spreadsheetInfo?.url && (
                <a
                  href={spreadsheetInfo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white border border-amber-500 hover:bg-amber-100 text-amber-900 text-sm font-bold rounded-lg cursor-pointer transition-colors inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Yêu cầu quyền trên Google</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => handleFetchSpreadsheet(accessToken!, currentUser?.email)}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded-lg cursor-pointer transition-colors"
              >
                Thử kết nối lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. KHU VỰC ĐẦU TRANG */}
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40 shadow-xs">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* Tiêu đề ứng dụng */}
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                <School className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                  SỔ ĐIỂM DANH GIẢNG VIÊN
                </h1>
                <p className="text-base text-slate-500">
                  Dùng chung 1 tập tin bảng tính Google Sheets cho tất cả giảng viên
                </p>
              </div>
            </div>

            {/* Nút Đăng nhập Google hoặc Thông tin người dùng */}
            <div>
              {currentUser ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl">
                    {currentUser.photoURL ? (
                      <img
                        src={currentUser.photoURL}
                        alt="Avatar"
                        className="w-7 h-7 rounded-full border border-blue-300"
                      />
                    ) : (
                      <UserCheck className="w-5 h-5 text-blue-600" />
                    )}
                    <div className="text-left">
                      <div className="text-sm font-bold text-blue-950 truncate max-w-[180px]">
                        {currentUser.displayName || currentUser.email}
                      </div>
                      <div className="text-xs text-blue-600 font-medium">Đã đăng nhập</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    title="Đăng xuất"
                    className="p-2.5 text-slate-500 hover:text-red-600 hover:bg-red-50 border border-slate-200 rounded-xl transition-colors cursor-pointer"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isAuthLoading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-5 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white font-semibold text-base rounded-xl shadow-md shadow-blue-600/20 transition-all cursor-pointer hover:shadow-lg"
                >
                  {isAuthLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <svg className="w-5 h-5 bg-white rounded-full p-0.5 shrink-0" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                      />
                    </svg>
                  )}
                  <span>{isAuthLoading ? 'Đang kết nối...' : 'Đăng nhập Google'}</span>
                </button>
              )}
            </div>
          </div>

          {/* DÒNG HIỆN TÊN BẢNG TÍNH & Ô CHỌN NGÀY HỌC */}
          <div className="mt-5 pt-4 border-t border-slate-150 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            {/* Tên bảng tính dùng chung */}
            <div className="md:col-span-7 flex items-center gap-3 bg-blue-50/70 border border-blue-200 rounded-xl px-4 py-3">
              <FileSpreadsheet className="w-6 h-6 text-blue-600 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="text-xs uppercase font-bold text-blue-600 tracking-wider block">
                  Bảng tính đang dùng chung:
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-lg font-bold text-blue-950 truncate block">
                    {isSpreadsheetLoading
                      ? 'Đang kiểm tra / kết nối bảng tính dùng chung...'
                      : currentUser && spreadsheetInfo
                      ? `${spreadsheetInfo.name} (Trang: DiemDanh)`
                      : 'Sổ điểm danh (Vui lòng đăng nhập Google)'}
                  </span>
                  {spreadsheetInfo?.url && (
                    <div className="flex items-center gap-1">
                      <a
                        href={spreadsheetInfo.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Mở trên Google Sheets"
                        className="text-blue-600 hover:text-blue-800 p-1 hover:bg-blue-100 rounded transition-colors shrink-0"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setShowShareModal(true)}
                        title="Chia sẻ quyền dùng chung cho giảng viên khác"
                        className="text-blue-700 hover:text-blue-900 p-1 hover:bg-blue-100 rounded transition-colors shrink-0 cursor-pointer flex items-center gap-1 text-xs font-semibold"
                      >
                        <Share2 className="w-4 h-4" />
                        <span className="hidden sm:inline">Chia sẻ</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <span
                className={`shrink-0 text-xs px-2.5 py-1 rounded-md font-semibold ${
                  currentUser && spreadsheetInfo
                    ? 'bg-blue-600 text-white'
                    : isSpreadsheetLoading
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-200 text-slate-700'
                }`}
              >
                {isSpreadsheetLoading
                  ? 'Đang kết nối...'
                  : currentUser && spreadsheetInfo
                  ? 'Dùng chung'
                  : 'Chờ đăng nhập'}
              </span>
            </div>

            {/* Ô chọn ngày học */}
            <div className="md:col-span-5 flex items-center gap-3 bg-white border-2 border-blue-600 rounded-xl px-4 py-2.5 shadow-xs">
              <Calendar className="w-6 h-6 text-blue-600 shrink-0" />
              <label htmlFor="study-date" className="text-base font-semibold text-slate-800 shrink-0">
                Ngày học:
              </label>
              <input
                id="study-date"
                type="date"
                value={selectedDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full text-lg font-bold text-blue-900 bg-transparent focus:outline-none cursor-pointer"
              />
            </div>
          </div>
        </div>
      </header>

      {/* 2. KHU VỰC NỘI DUNG CHÍNH / BẢNG LỚP */}
      <main className="max-w-6xl mx-auto px-6 mt-8">
        {!currentUser ? (
          /* KHI CHƯA ĐĂNG NHẬP: KHÔNG HIỂN THỊ THÔNG TIN ĐIỂM DANH */
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-10 sm:p-14 text-center shadow-xs flex flex-col items-center justify-center my-6 max-w-2xl mx-auto">
            <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-5 border border-blue-100 shadow-xs">
              <Lock className="w-10 h-10" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2 tracking-tight">
              Vui lòng đăng nhập Google để xem thông tin điểm danh
            </h2>
            <p className="text-base text-slate-500 mb-8 max-w-lg leading-relaxed">
              Thông tin danh sách sinh viên, trạng thái điểm danh và thống kê lớp học chỉ hiển thị sau khi giảng viên đăng nhập tài khoản Google. Dữ liệu sẽ được đồng bộ trực tiếp với tập tin bảng tính dùng chung.
            </p>
            <button
              type="button"
              onClick={handleGoogleLogin}
              disabled={isAuthLoading}
              className="inline-flex items-center justify-center gap-3 px-8 py-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 text-white font-bold text-lg rounded-xl shadow-md shadow-blue-600/30 transition-all cursor-pointer hover:shadow-lg"
            >
              {isAuthLoading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                <svg className="w-6 h-6 bg-white rounded-full p-0.5 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
              )}
              <span>{isAuthLoading ? 'Đang kết nối...' : 'Đăng nhập Google để xem điểm danh'}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Thanh công cụ phụ trợ trên bảng */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                <h2 className="text-xl font-bold text-slate-900">
                  Danh sách sinh viên lớp ({totalStudents} sinh viên)
                </h2>
              </div>
              <button
                type="button"
                onClick={markAllPresent}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 active:bg-blue-300 text-blue-800 text-base font-semibold rounded-lg transition-colors cursor-pointer self-start sm:self-auto"
              >
                <Check className="w-5 h-5 text-blue-700" />
                <span>Đánh dấu tất cả Có mặt</span>
              </button>
            </div>

            {/* BẢNG ĐIỂM DANH */}
        <div className="bg-white border-2 border-slate-200 rounded-2xl overflow-hidden shadow-sm relative">
          {isLoadingData && (
            <div className="absolute inset-0 bg-white/70 backdrop-blur-xs flex items-center justify-center z-10">
              <div className="flex items-center gap-3 px-5 py-3 bg-white border border-blue-200 rounded-xl shadow-lg">
                <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
                <span className="text-base font-bold text-blue-950">Đang đọc dữ liệu bảng tính dùng chung...</span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 text-base uppercase font-bold tracking-wide">
                  <th scope="col" className="py-4 px-4 text-center w-16">STT</th>
                  <th scope="col" className="py-4 px-5 w-32">Mã SV</th>
                  <th scope="col" className="py-4 px-6 w-60">Họ và tên</th>
                  <th scope="col" className="py-4 px-6 min-w-[340px] text-center">
                    Trạng thái điểm danh
                  </th>
                  <th scope="col" className="py-4 px-6 min-w-[240px]">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {students.map((student, index) => {
                  const isPresent = student.status === 'present';
                  const isAbsent = student.status === 'absent';
                  const isExcused = student.status === 'excused';

                  return (
                    <tr
                      key={student.id}
                      className={`hover:bg-blue-50/30 transition-colors ${
                        isAbsent ? 'bg-amber-50/20' : isExcused ? 'bg-blue-50/20' : 'bg-white'
                      }`}
                    >
                      {/* Số thứ tự */}
                      <td className="py-5 px-4 text-center text-lg font-medium text-slate-400">
                        {index + 1}
                      </td>

                      {/* Mã sinh viên */}
                      <td className="py-5 px-5">
                        <span className="font-mono text-lg font-extrabold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                          {student.code}
                        </span>
                      </td>

                      {/* Họ và tên */}
                      <td className="py-5 px-6">
                        <span className="text-xl font-bold text-slate-900 block">
                          {student.name}
                        </span>
                        <span className="text-xs text-slate-400">Sinh viên chính quy</span>
                      </td>

                      {/* Trạng thái (3 nút bấm: Có mặt / Vắng / Có phép) */}
                      <td className="py-5 px-6">
                        <div className="flex items-center justify-center gap-2">
                          {/* Nút Có mặt */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'present')}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 px-3 text-base font-bold rounded-xl transition-all cursor-pointer ${
                              isPresent
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-[1.02]'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                            }`}
                          >
                            <CheckCircle2 className={`w-5 h-5 ${isPresent ? 'text-white' : 'text-slate-400'}`} />
                            <span>Có mặt</span>
                          </button>

                          {/* Nút Vắng */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'absent')}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 px-3 text-base font-bold rounded-xl transition-all cursor-pointer ${
                              isAbsent
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-[1.02]'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                            }`}
                          >
                            <XCircle className={`w-5 h-5 ${isAbsent ? 'text-white' : 'text-slate-400'}`} />
                            <span>Vắng</span>
                          </button>

                          {/* Nút Có phép */}
                          <button
                            type="button"
                            onClick={() => handleStatusChange(student.id, 'excused')}
                            className={`flex-1 flex items-center justify-center gap-2 py-3 px-3 text-base font-bold rounded-xl transition-all cursor-pointer ${
                              isExcused
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/30 scale-[1.02]'
                                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900'
                            }`}
                          >
                            <ClockAlert className={`w-5 h-5 ${isExcused ? 'text-white' : 'text-slate-400'}`} />
                            <span>Có phép</span>
                          </button>
                        </div>
                      </td>

                      {/* Ghi chú */}
                      <td className="py-5 px-6">
                        <input
                          type="text"
                          value={student.note}
                          onChange={(e) => handleNoteChange(student.id, e.target.value)}
                          placeholder="Ghi chú (đi trễ, lý do...)"
                          className="w-full text-base px-3 py-2.5 rounded-lg border border-slate-300 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-100 focus:outline-none transition-colors"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. PHÍA DƯỚI BẢNG: THỐNG KÊ & NÚT LƯU, TẢI LẠI */}
        <div className="mt-8 bg-blue-50/50 border-2 border-blue-200 rounded-2xl p-6 shadow-sm">
          {/* DÒNG THỐNG KÊ (tự động đếm, không lưu vào bảng tính) */}
          <div className="mb-6 pb-6 border-b border-blue-200">
            <h3 className="text-base font-bold text-blue-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <span>Thống kê chuyên cần buổi học</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {/* Tổng số sinh viên */}
              <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col items-center justify-center shadow-xs">
                <span className="text-sm font-semibold text-slate-500">Tổng số sinh viên</span>
                <span className="text-3xl font-extrabold text-slate-900 mt-1">{totalStudents}</span>
              </div>

              {/* Số có mặt */}
              <div className="bg-white border-2 border-blue-600 rounded-xl p-4 flex flex-col items-center justify-center shadow-xs">
                <span className="text-sm font-bold text-blue-700 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-blue-600" />
                  Số có mặt
                </span>
                <span className="text-3xl font-extrabold text-blue-700 mt-1">{countPresent}</span>
              </div>

              {/* Số vắng */}
              <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col items-center justify-center shadow-xs">
                <span className="text-sm font-semibold text-slate-600 flex items-center gap-1.5">
                  <XCircle className="w-4 h-4 text-slate-500" />
                  Số vắng
                </span>
                <span className="text-3xl font-extrabold text-slate-800 mt-1">{countAbsent}</span>
              </div>

              {/* Số có phép */}
              <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col items-center justify-center shadow-xs">
                <span className="text-sm font-semibold text-slate-600 flex items-center gap-1.5">
                  <ClockAlert className="w-4 h-4 text-slate-500" />
                  Số có phép
                </span>
                <span className="text-3xl font-extrabold text-slate-800 mt-1">{countExcused}</span>
              </div>
            </div>
          </div>

          {/* CÁC NÚT HÀNH ĐỘNG DƯỚI BẢNG */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-4">
            {/* Nút Tải lại từ bảng tính */}
            <button
              type="button"
              disabled={isLoadingData || isSpreadsheetLoading}
              onClick={handleReloadFromSpreadsheet}
              className="inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-white hover:bg-blue-50 active:bg-blue-100 disabled:opacity-60 text-blue-700 border-2 border-blue-600 font-bold text-lg rounded-xl shadow-xs transition-all cursor-pointer"
            >
              <RotateCw className={`w-5 h-5 text-blue-600 ${isLoadingData || isSpreadsheetLoading ? 'animate-spin' : ''}`} />
              <span>{isLoadingData ? 'Đang tải lại...' : 'Tải lại từ bảng tính'}</span>
            </button>

            {/* Nút Lưu điểm danh */}
            <button
              type="button"
              disabled={isSaving}
              onClick={handleSaveAttendance}
              className="inline-flex items-center justify-center gap-3 px-8 py-3.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-75 text-white font-bold text-lg rounded-xl shadow-md shadow-blue-600/30 transition-all cursor-pointer hover:shadow-lg"
            >
              {isSaving ? (
                <Loader2 className="w-5 h-5 animate-spin text-white" />
              ) : (
                <Save className="w-5 h-5 text-white" />
              )}
              <span>{isSaving ? 'Đang lưu...' : 'Lưu điểm danh'}</span>
            </button>
          </div>
        </div>
      </>
    )}
  </main>

      {/* MODAL CHIA SẺ BẢNG TÍNH DÙNG CHUNG */}
      {showShareModal && spreadsheetInfo && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Share2 className="w-5 h-5 text-blue-600" />
                <h3 className="text-xl font-bold text-slate-900">Chia sẻ bảng tính dùng chung</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowShareModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="mt-4 space-y-4 max-h-[75vh] overflow-y-auto pr-1">
              <p className="text-base text-slate-600">
                Tập tin bảng tính dùng chung: <span className="font-bold text-slate-900">{spreadsheetInfo.name}</span>
              </p>

              {/* Tùy chọn cho tổ chức (Ví dụ: fpt.edu.vn) */}
              {currentUser?.email && currentUser.email.includes('@') && currentUser.email.split('@')[1] !== 'gmail.com' && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <h4 className="font-bold text-emerald-950 text-base mb-1">
                    Cấp quyền cho tổ chức @{currentUser.email.split('@')[1]} (Khuyên dùng)
                  </h4>
                  <p className="text-sm text-emerald-800 mb-3">
                    Chính sách của trường/tổ chức thường chặn chia sẻ công khai ra ngoài. Tùy chọn này cho phép tất cả giảng viên có email đuôi @{currentUser.email.split('@')[1]} cùng chỉnh sửa ngay lập tức.
                  </p>
                  <button
                    type="button"
                    disabled={isSharing}
                    onClick={() => handleShareWithDomainMembers(currentUser.email!.split('@')[1])}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold rounded-lg text-sm shadow-xs transition-colors cursor-pointer"
                  >
                    {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    <span>Cấp quyền cho toàn bộ @{currentUser.email.split('@')[1]}</span>
                  </button>
                </div>
              )}

              {/* 1. Mở quyền chỉnh sửa bằng link */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4">
                <h4 className="font-bold text-blue-950 text-base mb-1">Cách 1: Mở quyền cho bất kỳ ai có liên kết (Writer)</h4>
                <p className="text-sm text-slate-600 mb-3">
                  Cấp quyền Người chỉnh sửa (Writer) cho bất kỳ tài khoản nào đăng nhập ứng dụng này. (Lưu ý: Có thể bị quản trị viên Workspace chặn nếu tài khoản trường cấm chia sẻ công khai).
                </p>
                <button
                  type="button"
                  disabled={isSharing}
                  onClick={handleMakePublicEditable}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-lg text-sm shadow-xs transition-colors cursor-pointer"
                >
                  {isSharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>Mở quyền chỉnh sửa cho liên kết</span>
                </button>
              </div>

              {/* 2. Chia sẻ cho email cụ thể */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h4 className="font-bold text-slate-900 text-base mb-1">Cách 2: Cấp quyền cho email cụ thể</h4>
                <p className="text-xs text-slate-500 mb-2">
                  Nhập email của đồng nghiệp để cấp quyền Người chỉnh sửa trực tiếp:
                </p>
                <form onSubmit={handleShareWithSpecificEmail} className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      placeholder="dongnghiep@fpt.edu.vn"
                      value={shareEmailInput}
                      onChange={(e) => setShareEmailInput(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSharing}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-bold rounded-lg cursor-pointer transition-colors"
                  >
                    Chia sẻ
                  </button>
                </form>
              </div>

              {/* 3. Mở Google Sheets phân quyền trực tiếp */}
              <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4">
                <h4 className="font-bold text-amber-950 text-base mb-1">Cách 3: Chia sẻ trực tiếp trên Google Sheets (100% chuẩn)</h4>
                <p className="text-sm text-amber-900 mb-3">
                  Mở file trực tiếp trên Google Sheets, bấm nút <strong>"Chia sẻ" (Share)</strong> màu xanh góc phải để cấp quyền Người chỉnh sửa theo giao diện chuẩn của Google.
                </p>
                {spreadsheetInfo.url && (
                  <a
                    href={spreadsheetInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg text-sm shadow-xs transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Mở Google Sheets để phân quyền</span>
                  </a>
                )}
              </div>

              {/* 4. Sao chép link ứng dụng */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCopyShareLink}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 border-2 border-blue-600 text-blue-700 font-bold rounded-xl text-base hover:bg-blue-50 transition-colors cursor-pointer"
                >
                  <Copy className="w-5 h-5" />
                  <span>Sao chép liên kết ứng dụng có mã bảng tính</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className="max-w-6xl mx-auto px-6 mt-12 pt-6 border-t border-slate-200 text-center text-sm text-slate-400">
        Phần mềm Sổ điểm danh Giảng viên • Chế độ dùng chung một tập tin Google Sheets
      </footer>
    </div>
  );
}
