# Closeté — Flutter Implementation Guideline

> Version: 1.1 | Last Updated: 2026-07-26 | Status: Implementation Ready (Audited & Corrected)

⚠️ **Known Backend Issue**: `POST /auth/resend-otp` requires USER JWT, making it impossible for unverified users to resend OTP. Backend must be fixed to accept email without JWT. Flutter should surface the UX option but alert backend devs, or route unverified users through a custom "re-register" flow or public `resend-otp` endpoint if one is added.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture & Layered Structure](#2-architecture--layered-structure)
3. [Setup & Environment Configuration](#3-setup--environment-configuration)
4. [API Base Configuration](#4-api-base-configuration)
5. [Authentication Flow](#5-authentication-flow)
6. [State Management](#6-state-management)
7. [API Integration Patterns](#7-api-integration-patterns)
8. [Module-by-Module Implementation Guide](#8-module-by-module-implementation-guide)
9. [File Upload & Media Handling](#9-file-upload--media-handling)
10. [Socket.io for Real-time Updates](#10-socketio-for-real-time-updates)
11. [Payment Integration (Stripe)](#11-payment-integration-stripe)
12. [Error Handling & User Feedback](#12-error-handling--user-feedback)
13. [Navigation & Routing](#13-navigation--routing)
14. [Form Validation](#14-form-validation)
15. [Testing Strategy](#15-testing-strategy)
16. [Performance & Best Practices](#16-performance--best-practices)
17. [Appendix: Full API Reference](#17-appendix-full-api-reference)

---

## 1. Project Overview

### What is Closeté?

A **luxury resale marketplace mobile app** where every user is both a buyer and seller. Core flows:

- **Buyer**: Browse feed → View product → Wishlist → Checkout → Track order status → Receive delivery
- **Seller**: Capture photo → AI analysis → Review listing → Post item → Track sale → Receive payout

### User Roles

| Role | Description |
|------|-------------|
| `USER` | All mobile app users (buyer = seller, same role) |
| `ADMIN` | Operations staff for web dashboard |
| `SUPER_ADMIN` | Full system admin access |

### Platform Fee Model

- **12% platform commission** on all sales (configurable via `PLATFORM_FEE_PERCENTAGE` env)
- Seller earnings = `listingPrice × (1 - 0.12)`
- Calculated server-side at order creation (`platformFee`, `sellerPayout` fields on Order model)
- Always display computed values from API; never recalculate client-side-only logic for display

---

## 2. Architecture & Layered Structure

### Recommended Architecture: Feature-First (Clean)

```
lib/
├── main.dart
├── app.dart
├── core/
│   ├── config/                # Environment, constants
│   │   ├── app_config.dart
│   │   ├── api_endpoints.dart
│   │   └── app_constants.dart
│   ├── theme/                 # Colors, typography, theme
│   │   ├── app_theme.dart
│   │   ├── app_colors.dart
│   │   └── app_text_styles.dart
│   ├── errors/                # Failure/exception classes
│   │   ├── failures.dart
│   │   └── exceptions.dart
│   ├── network/               # Dio client, interceptors
│   │   ├── dio_client.dart
│   │   ├── auth_interceptor.dart
│   │   ├── error_interceptor.dart
│   │   └── pretty_logger.dart
│   ├── storage/               # Hive/Secure Storage
│   │   ├── secure_storage.dart
│   │   └── local_storage.dart
│   ├── router/                # GoRouter
│   │   └── app_router.dart
│   ├── utils/                 # Helpers
│   │   ├── date_formatter.dart
│   │   ├── currency_formatter.dart
│   │   ├── image_picker_helper.dart
│   │   └── debouncer.dart
│   └── widgets/               # Reusable UI components
│       ├── buttons/
│       ├── inputs/
│       ├── cards/
│       ├── empty_state.dart
│       ├── loading_overlay.dart
│       └── error_widget.dart
├── data/
│   ├── models/                # JSON-serializable models
│   │   ├── user/
│   │   ├── product/
│   │   ├── order/
│   │   ├── wishlist/
│   │   ├── issue/
│   │   ├── ai/
│   │   ├── auth/
│   │   └── common/
│   │       ├── api_response.dart
│   │       ├── pagination.dart
│   │       └── error_message.dart
│   ├── datasources/           # Remote + local data sources
│   │   ├── remote/
│   │   │   ├── auth_remote_ds.dart
│   │   │   ├── product_remote_ds.dart
│   │   │   ├── order_remote_ds.dart
│   │   │   ├── wishlist_remote_ds.dart
│   │   │   ├── ai_remote_ds.dart
│   │   │   ├── user_remote_ds.dart
│   │   │   └── payment_remote_ds.dart
│   │   └── local/
│   │       └── auth_local_ds.dart
│   └── repositories/          # Data layer boundary
│       ├── auth_repository.dart
│       ├── product_repository.dart
│       ├── order_repository.dart
│       ├── wishlist_repository.dart
│       ├── ai_repository.dart
│       └── user_repository.dart
├── domain/
│   ├── entities/              # Pure Dart business objects (optional)
│   └── usecases/              # Business rules
│       ├── auth/
│       ├── product/
│       ├── order/
│       └── wishlist/
├── features/
│   ├── splash/
│   ├── onboarding/
│   ├── auth/
│   │   ├── login/
│   │   ├── register/
│   │   ├── verify_email/
│   │   ├── forget_password/
│   │   └── bloc/
│   │       ├── auth_bloc.dart
│   │       ├── auth_event.dart
│   │       └── auth_state.dart
│   ├── home/                  # Product feed
│   │   ├── pages/
│   │   ├── widgets/
│   │   └── bloc/
│   ├── product/
│   │   ├── detail/
│   │   ├── sell/              # AI listing flow
│   │   └── bloc/
│   ├── wishlist/
│   ├── checkout/
│   ├── orders/                # Order list + detail
│   ├── profile/
│   │   ├── wardrobe/
│   │   ├── purchases/
│   │   └── settings/
│   └── common_widgets/
├── services/
│   ├── socket_service.dart    # Socket.io client
│   └── payment_service.dart   # Stripe SDK wrapper
└── injection_container.dart   # get_it setup
```

### Key Architectural Principles

1. **Unidirectional data flow**: UI → Bloc → UseCase → Repository → DataSource
2. **Separation of concerns**: Never call Dio directly from UI; always go through repository
3. **Immutable state**: Use `freezed` or `Equatable` for all state classes
4. **Error-first**: Every async operation returns `Either<Failure, T>` or has explicit error state

---

## 3. Setup & Environment Configuration

### Required Flutter SDK

- Flutter `3.19+`
- Dart `3.3+`

### Required Dependencies (pubspec.yaml)

```yaml
dependencies:
  flutter:
    sdk: flutter

  # State management
  flutter_bloc: ^8.1.5
  equatable: ^2.0.5

  # Service locator
  get_it: ^7.7.0
  injectable: ^2.4.4

  # Navigation
  go_router: ^14.2.0

  # Networking
  dio: ^5.4.3+1
  retrofit: ^4.1.0
  pretty_dio_logger: ^1.3.1

  # Socket.io
  socket_io_client: ^2.0.3+1

  # Storage
  flutter_secure_storage: ^9.2.2
  hive: ^2.2.3
  hive_flutter: ^1.1.0

  # JSON serialization
  json_annotation: ^4.9.0
  freezed_annotation: ^2.4.1

  # Forms & validation
  formz: ^0.7.0

  # Image handling
  image_picker: ^1.1.2
  cached_network_image: ^3.3.1
  photo_view: ^0.15.0

  # Payment
  flutter_stripe: ^11.0.0

  # Utils
  intl: ^0.19.0
  logger: ^2.3.0
  universal_platform: ^1.0.0+1
  connectivity_plus: ^6.0.3
  shimmer: ^3.0.0
  collection: ^1.18.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  build_runner: ^2.4.11
  json_serializable: ^6.8.0
  freezed: ^2.5.2
  injectable_generator: ^2.6.1
  retrofit_generator: ^8.1.0
  mockito: ^5.4.4
  bloc_test: ^9.1.7
```

### Environment Setup (Flavors)

Support **3 flavors**: `development`, `staging`, `production`.

```dart
// core/config/app_config.dart
class AppConfig {
  final String appName;
  final String baseUrl;
  final String socketUrl;
  final String stripePublishableKey;

  const AppConfig({
    required this.appName,
    required this.baseUrl,
    required this.socketUrl,
    required this.stripePublishableKey,
  });
}

// main_dev.dart
void main() {
  const config = AppConfig(
    appName: 'Closeté Dev',
    baseUrl: 'http://localhost:5000/api/v1',
    socketUrl: 'http://localhost:5000',
    stripePublishableKey: 'pk_test_xxx',
  );
  runApp(MyApp(config: config));
}

// main_prod.dart
void main() {
  const config = AppConfig(
    appName: 'Closeté',
    baseUrl: 'https://api.closete.app/api/v1',
    socketUrl: 'https://api.closete.app',
    stripePublishableKey: 'pk_live_xxx',
  );
  runApp(MyApp(config: config));
}
```

---

## 4. API Base Configuration

### Base URL & API Prefix

- **All endpoints** are prefixed with `/api/v1`
- Construct URLs as: `$baseUrl/$path` (do NOT double the prefix)

### Standard Response Format

**Every successful API response follows this envelope structure:**

```dart
// data/models/common/api_response.dart
@freezed
class ApiResponse<T> with _$ApiResponse<T> {
  const factory ApiResponse({
    required bool success,
    String? message,
    PaginationMeta? pagination,
    T? data,
  }) = _ApiResponse;

  factory ApiResponse.fromJson(
    Map<String, dynamic> json,
    T Function(Object?) fromJsonT,
  ) => _$ApiResponseFromJson(json, fromJsonT);
}

@freezed
class PaginationMeta with _$PaginationMeta {
  const factory PaginationMeta({
    required int total,
    required int limit,
    required int page,
    required int totalPage,
  }) = _PaginationMeta;
  factory PaginationMeta.fromJson(Map<String, dynamic> json) =>
      _$PaginationMetaFromJson(json);
}
```

**Success example:**
```json
{
  "success": true,
  "message": "User logged in successfully.",
  "data": {
    "accessToken": "eyJhbGciOiJ...",
    "refreshToken": "eyJhbGciOiJ..."
  }
}
```

**Paginated success example:**
```json
{
  "success": true,
  "data": [/* ... array of products ... */],
  "pagination": {
    "total": 47,
    "limit": 10,
    "page": 1,
    "totalPage": 5
  }
}
```

**Standard Error Format:**

```json
{
  "success": false,
  "message": "Password is incorrect!",
  "errorMessages": [
    {
      "path": "",
      "message": "Password is incorrect!"
    }
  ]
}
```

**Zod validation error (inline field errors via `path`):**
```json
{
  "success": false,
  "message": "Validation error",
  "errorMessages": [
    { "path": "email", "message": "Invalid email" },
    { "path": "password", "message": "Password is required" }
  ],
  "stack": "..."  // ONLY in development, omit in production
}
```

Dart model for errors:

```dart
@freezed
class ErrorMessage with _$ErrorMessage {
  const factory ErrorMessage({
    String? path,
    required String message,
  }) = _ErrorMessage;
  factory ErrorMessage.fromJson(Map<String, dynamic> json) => _$ErrorMessageFromJson(json);
}

@freezed
class ApiErrorResponse with _$ApiErrorResponse {
  const factory ApiErrorResponse({
    required bool success,
    required String message,
    List<ErrorMessage>? errorMessages,
    String? stack,
  }) = _ApiErrorResponse;
  factory ApiErrorResponse.fromJson(Map<String, dynamic> json) => _$ApiErrorResponseFromJson(json);
}
```

### Query Parameter Naming (Pagination, Search)

⚠️ **CRITICAL** — These exact names are used by `QueryBuilder` on backend:

| Purpose | Parameter |
|---------|-----------|
| Page number | `page` (default 1) |
| Page size | `limit` (default 10) |
| Search text | `searchTerm` (NOT `search` — searched against `name`, `brand`, `description` for products) |
| Sort order | `sort` (default `-createdAt`; prefix `-` for DESC. Example: `sort=-price`) |
| Field projection | `fields` (comma-separated, default excludes `__v`) |
| Direct filter | Any field name not in exclusion list. Example: `status=available&brand=Gucci` |

### Dio Client Setup

```dart
// core/network/dio_client.dart
@injectable
class DioClient {
  final AppConfig _config;
  final AuthInterceptor _authInterceptor;
  final ErrorInterceptor _errorInterceptor;

  DioClient(this._config, this._authInterceptor, this._errorInterceptor) {
    _dio = Dio(BaseOptions(
      baseUrl: _config.baseUrl,
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 60),
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    ));

    _dio.interceptors.addAll([
      _authInterceptor,
      _errorInterceptor,
      PrettyDioLogger(
        requestHeader: true,
        requestBody: true,
        responseBody: true,
        error: true,
        compact: true,
        maxWidth: 120,
      ),
    ]);
  }

  late final Dio _dio;
  Dio get instance => _dio;
}
```

---

## 5. Authentication Flow

### Authentication Mechanism

- **JWT Bearer Token** auth with 2-token system
- Tokens are obtained at login/register and must be sent as: `Authorization: Bearer <accessToken>`
- **Access Token**: Short-lived (e.g. 1h), used for API calls
- **Refresh Token**: Longer-lived, used only to obtain new access tokens

### Storage of Tokens

**IMPORTANT:** Never store tokens in Hive/shared_preferences (unencrypted). Use `flutter_secure_storage`.

```dart
// core/storage/secure_storage.dart
@injectable
class SecureStorage {
  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  static const _kAccessToken = 'access_token';
  static const _kRefreshToken = 'refresh_token';
  static const _kUserId = 'user_id';

  Future<void> saveTokens(String access, String refresh) async {
    await _storage.write(key: _kAccessToken, value: access);
    await _storage.write(key: _kRefreshToken, value: refresh);
  }

  Future<String?> getAccessToken() => _storage.read(key: _kAccessToken);
  Future<String?> getRefreshToken() => _storage.read(key: _kRefreshToken);

  Future<void> clearAll() async {
    await _storage.deleteAll();
  }
}
```

### Auth Interceptor with Token Refresh

```dart
// core/network/auth_interceptor.dart
@injectable
class AuthInterceptor extends Interceptor {
  final SecureStorage _secureStorage;
  @Named('noAuth') final Dio _noAuthDio;
  final AppConfig _config;
  bool _refreshInFlight = false;

  AuthInterceptor(this._secureStorage, this._noAuthDio, this._config);

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    // Special case: reset-password endpoint uses raw crypto token (NOT Bearer JWT)
    // Do NOT add Bearer prefix for that call. We identify it by path.
    final isResetPassword = options.path.contains('/auth/reset-password');

    if (isResetPassword) {
      // Caller must have already set options.headers['Authorization'] = rawCryptoToken
      return super.onRequest(options, handler);
    }

    final token = await _secureStorage.getAccessToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    return super.onRequest(options, handler);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401
        && !err.requestOptions.path.contains('/auth/refresh-token')
        && !err.requestOptions.path.contains('/auth/reset-password')) {
      final refreshed = await _tryRefresh();
      if (refreshed) {
        final opts = err.requestOptions;
        final newToken = await _secureStorage.getAccessToken();
        opts.headers['Authorization'] = 'Bearer $newToken';
        try {
          final response = await _noAuthDio.fetch(opts);
          return handler.resolve(response);
        } on DioException catch (e) {
          return handler.next(e);
        }
      }
    }
    return super.onError(err, handler);
  }

  Future<bool> _tryRefresh() async {
    if (_refreshInFlight) return false;
    _refreshInFlight = true;
    try {
      final refresh = await _secureStorage.getRefreshToken();
      if (refresh == null) return false;

      final response = await _noAuthDio.post(
        '${_config.baseUrl}/auth/refresh-token',
        data: {'refreshToken': refresh},
      );
      final newAccess = response.data['data']['accessToken'] as String;
      await _secureStorage.saveTokens(newAccess, refresh);
      return true;
    } catch (_) {
      await _secureStorage.clearAll();
      // Broadcast auth failure → redirect to login
      // Use your global event bus / bloc listener pattern
      return false;
    } finally {
      _refreshInFlight = false;
    }
  }
}
```

### Full Auth Flow Sequence

#### 1. Registration Flow

```
Sign Up Screen (name, email, password, contact, location)
    ↓ POST /user/
Response: { verified:false (implied via register route), ...user }
Snackbar: "Account created. Check your email for the OTP."
    ↓
Verify Email Screen (6-digit OTP input, pre-filled email)
    ↓ POST /auth/verify-email  { email, oneTimeCode }
Case A — First-time activation (user.verified==false before):
    → account activated, response.data = null
    → Goto Login Screen
Case B — User already verified (called from Forget Password flow):
    → response.data = cryptoResetToken (string)
    → Save cryptoResetToken to memory/transient state
    → Goto New Password Screen
```

⚠️ **Resend OTP During Verify-Email Catch-22**: `POST /auth/resend-otp` requires a **verified USER JWT**, which the user does NOT have while on the Verify Email screen. **Backend MUST be fixed** to add a public endpoint accepting `{ email }` without JWT. **Flutter workaround options pending backend fix:** 
- Option 1: Hide the Resend button and tell users to re-register with same email after 3 min expiry — backend gracefully upserts with new OTP (confirm this behavior)
- Option 2: Backend adds `POST /auth/resend-otp-public { email }` rate-limited

#### 2. Login Flow

```
Login Screen (email, password)
    ↓ POST /auth/login  { email, password }
Case — Success:
  { accessToken, refreshToken } → SecureStorage
  AuthBloc → Authenticated state
  Router → HomeScreen
Case — Failure statusCode=400 + message contains "Please verify your account":
  → Navigate to VerifyEmailScreen(email: email)
  → Show toast: "Account not verified yet. Enter the OTP sent to your email."
Case — Failure statusCode=400 + message contains "deactivated":
  → Dialog: contact support
```

#### 3. Forget Password Flow

```
"Forgot Password?" → Enter email screen
    ↓ POST /auth/forget-password  { email }
Snackbar: "OTP sent to email"
    ↓
Enter OTP Screen (same VerifyEmailScreen UI, but resetMode=true)
    ↓ POST /auth/verify-email  { email, oneTimeCode }
  Returns: response.data = cryptoResetToken (string)
  Save cryptoResetToken to state. Do NOT store in SecureStorage.
    ↓
New Password Screen (newPassword + confirmPassword)
    ↓ POST /auth/reset-password
       HEADERS: Authorization = <cryptoResetToken>  (NO Bearer prefix!)
       BODY: { newPassword, confirmPassword }
Password updated → Snackbar + Login Screen
```

⚠️ **CRITICAL Non-Standard Auth for Reset-Password:**
The token is sent as raw value in `Authorization` header. NOT `Bearer <token>`. NOT as query param. NOT in body. Flutter implementation must handle this as a one-off special case.

---

## 6. State Management

### Recommended: flutter_bloc

**Why?**
- Excellent separation of concerns
- Predictable state transitions (critical for auth/socket flows)
- Built-in event transformers for debounce search, throttle checkout button
- `bloc_test` for easy testing

### Bloc Structure Pattern

Every feature Bloc uses this same skeleton:

```dart
// features/auth/login/bloc/login_bloc.dart
@injectable
class LoginBloc extends Bloc<LoginEvent, LoginState> {
  final AuthRepository _authRepository;

  LoginBloc(this._authRepository) : super(const LoginState.initial()) {
    on<LoginSubmitted>(_onSubmitted, transformer: droppable());
    on<LoginEmailChanged>(_onEmailChanged);
    on<LoginPasswordChanged>(_onPasswordChanged);
    on<LoginPasswordVisibilityToggled>(_onVisibilityToggled);
  }

  Future<void> _onSubmitted(LoginSubmitted event, Emitter<LoginState> emit) async {
    emit(state.copyWith(status: FormzSubmissionStatus.inProgress));
    final result = await _authRepository.login(
      email: state.email.value,
      password: state.password.value,
    );
    result.fold(
      (failure) => emit(state.copyWith(
        status: FormzSubmissionStatus.failure,
        errorMessage: failure.message,
      )),
      (_) => emit(state.copyWith(status: FormzSubmissionStatus.success)),
    );
  }
  // ... other event handlers
}

// state
@freezed
class LoginState with _$LoginState {
  const factory LoginState({
    required Email email,
    required Password password,
    required bool obscurePassword,
    required FormzSubmissionStatus status,
    String? errorMessage,
  }) = _LoginState;

  const factory LoginState.initial() = _LoginInitial;
}
```

### Server Cache State: riverpod or cached_query?

For **read-heavy** screens (product feed, order list), use `cached_query` or manually cache in Hive with expiry. The backend supports pagination via `QueryBuilder` (page/limit params) — always implement infinite scroll with `ListView.builder` + pagination.

---

## 7. API Integration Patterns

### Repository Pattern + Either

```dart
// core/errors/failures.dart
abstract class Failure {
  final String message;
  final int? statusCode;
  const Failure(this.message, [this.statusCode]);
}

class ServerFailure extends Failure {
  final List<ErrorMessage>? errors;
  const ServerFailure(super.message, super.statusCode, {this.errors});
}

class NetworkFailure extends Failure {
  const NetworkFailure() : super('No internet connection. Please check your network.');
}

class TimeoutFailure extends Failure {
  const TimeoutFailure() : super('Request timed out. Please try again.');
}

class UnauthorizedFailure extends Failure {
  const UnauthorizedFailure([String msg = 'Session expired. Please log in again.']) : super(msg, 401);
}
```

```dart
// data/repositories/auth_repository.dart
@Injectable(as: AuthRepository)
class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDataSource _remote;
  final AuthLocalDataSource _local;

  AuthRepositoryImpl(this._remote, this._local);

  @override
  Future<Either<Failure, void>> register({
    required String name,
    required String email,
    required String password,
    required String contact,
    required String location,
  }) async {
    try {
      await _remote.register(RegisterRequest(
        name: name,
        email: email,
        password: password,
        contact: contact,
        location: location,
      ));
      return const Right(null);
    } on DioException catch (e) {
      return Left(_mapDioToFailure(e));
    }
  }

  Failure _mapDioToFailure(DioException e) {
    // Handle SocketException → NetworkFailure
    // timeout → TimeoutFailure
    // response 401 → UnauthorizedFailure
    // parse errorMessages from response.data['errorMessages'] → inline field errors
  }
}
```

### Retrofit for Remote DataSource (Optional but Recommended)

```dart
// data/datasources/remote/auth_remote_ds.dart
@RestApi()
abstract class AuthRemoteDataSource {
  factory AuthRemoteDataSource(Dio dio, {String baseUrl}) = _AuthRemoteDataSource;

  @POST('/auth/login')
  Future<ApiResponse<LoginResponse>> login(@Body() LoginRequest body);

  @POST('/auth/refresh-token')
  Future<ApiResponse<RefreshTokenResponse>> refreshToken(@Body() RefreshTokenRequest body);

  @POST('/user/')
  Future<ApiResponse<UserModel>> register(@Body() RegisterRequest body);

  @POST('/auth/verify-email')
  Future<ApiResponse<String?>> verifyEmail(@Body() VerifyEmailRequest body);

  @POST('/auth/forget-password')
  Future<ApiResponse<void>> forgetPassword(@Body() ForgetPasswordRequest body);

  // ⚠️ Special: reset-password uses raw crypto token in Authorization.
  // When calling manually, set: options: Options(headers: {'Authorization': rawToken})
  @POST('/auth/reset-password')
  Future<ApiResponse<void>> resetPassword(
    @Body() ResetPasswordRequest body,
  );

  @POST('/auth/resend-otp')
  Future<ApiResponse<void>> resendOtp(); // requires verified USER JWT

  @POST('/auth/change-password')
  Future<ApiResponse<void>> changePassword(@Body() ChangePasswordRequest body);
}
```

**For non-Retrofit approach** — use the `DioClient` directly and parse with `ApiResponse.fromJson`.

---

## 8. Module-by-Module Implementation Guide

### 8.1 Onboarding (Low Priority)

3 static scroll screens, no backend. After completion → navigate to auth.

### 8.2 Authentication Module

#### Models

```dart
// data/models/auth/login_response.dart
@freezed
class LoginResponse with _$LoginResponse {
  const factory LoginResponse({
    required String accessToken,
    required String refreshToken,
  }) = _LoginResponse;
  factory LoginResponse.fromJson(Map<String, dynamic> json) => _$LoginResponseFromJson(json);
}

@freezed
class VerifyEmailRequest with _$VerifyEmailRequest {
  const factory VerifyEmailRequest({
    required String email,
    required int oneTimeCode,
  }) = _VerifyEmailRequest;
  Map<String, dynamic> toJson() => {'email': email, 'oneTimeCode': oneTimeCode};
}
```

#### Key Screens & Notes

| Screen | Validation | On Success |
|--------|-----------|------------|
| Register (`/auth/register`) | Email (valid format), Password ≥ 6 chars, Contact non-empty, Location non-empty | Show VerifyEmailPage with email prefilled; snackbar: "Check your email for OTP" |
| Verify Email | 6-digit OTP numeric | If activation → Login Page; if reset-token returned → NewPassword page, store token in-memory |
| Resend OTP Button | Cooldown 60s timer; disabled until backend fixes to accept unauthenticated `{email}` body | Snackbar: "OTP resent" |
| Login | Same as above form | Save tokens → AuthBloc → Home |
| Forget Password → Enter Email | Valid email | Goto VerifyEmail page |
| Forget Password → New Password | New = Confirm, ≥ 6 chars | POST reset-password with raw token in Authorization header |
| Change Password | Current + New + Confirm | Profile → Snackbar |

### 8.3 Products / Home Feed

#### Model

```dart
// data/models/product/product_model.dart
@freezed
class ProductModel with _$ProductModel {
  const factory ProductModel({
    required String id,
    required String name,
    required String image,        // Single S3 URL string (not array)
    required String brand,
    required String description,
    required double price,
    required String condition,
    String? proofOfPurchase,
    required ProductStatus status,  // 'available' | 'secured' | 'sold'
    required String seller,       // ObjectId string
    required int orderId,
    String? buyer,
  }) = _ProductModel;

  factory ProductModel.fromJson(Map<String, dynamic> json) => _$ProductModelFromJson(json);
}

enum ProductStatus { available, secured, sold }
```

#### List Endpoint: `GET /products`

⚠️ **Backend Default Filtering**: Implicitly adds `status=available` to every request UNLESS you explicitly send `?status=...` in query. For Wardrobe / My Listings view showing ALL seller's products regardless of status, you MUST send `status=` (any/all) or explicitly query per status.

Query params (all optional):
- `page`: number (default 1)
- `limit`: number (default 10; recommend 20 for mobile grid)
- `searchTerm`: string (NOT `search`) — searched against name / brand / description
- `brand`: string (exact match)
- `sort`: e.g. `-price` (DESC) or `createdAt` (ASC); default `-createdAt`
- `status`: `available` (default) | `secured` | `sold`

**UI Contract:**
- GridView (2 columns) with `Shimmer` loading placeholders while fetching
- Pull-to-refresh via `RefreshIndicator`
- Infinite scroll: when scrolled to last 3 items, fetch next page (use `pagination.totalPage` to stop)
- Each card: image (cache!), seller info, price (formatted as AED), heart (wishlist toggle — debounce taps)
- Tapping card → Product Detail

#### Detail Endpoint: `GET /products/:id`

Larger gallery, seller avatar/location/contact (populated), description, full condition text, "Secure This Item" CTA button.

### 8.4 Wishlist Module

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/wishlist` | GET | USER | Current user's wishlist items (list of product populated) |
| `/wishlist/:productId` | POST | USER | Add product to wishlist |
| `/wishlist/:productId` | DELETE | USER | Remove product |

**Bloc Behavior:**
- Toggle heart icon → if currently filled, DELETE; else POST
- **Debounce/optimistic UI**: Immediately flip UI state, then rollback if API fails (show snackbar)
- Separate `WishlistCubit` that stores `Set<String>` of wished product IDs → O(1) lookup for feed cards

### 8.5 Sell Flow + AI Listing (Complex — High Priority)

This is the most complex UX flow. Break into 4 pages with a stepper:

**Step 1: Media Capture**
- Allow photo capture + upload (image_picker)
- Display grid of selected images (Backend only uses `image[0]` — the first one — today, even though multer allows 3. Future-proof UI to multiple; send all under `image[]` multipart array with 0-indexed keys)
- Optional: proof-of-purchase PDF (field name `doc`)

**Step 2: AI Analysis Loading**
- Call `POST /ai/analyze-listing` (multipart — see File Upload section)
- Full-screen loading with animated brand-analysis text ("Analyzing brand…", "Detecting condition…")
- On response: extract `{ imageUrl, brand, category, condition, suggestedPrice, description, authenticityConfidence, attributes }`
- On error: toast + "Retry" or "Fill in manually" button

**Step 3: Review & Edit Listing**
- Pre-fill ALL fields from AI response; user edits as needed
- Fields:
  - `name` (string, required)
  - `brand` (string, required)
  - `description` (string, required, multiline)
  - `price` (number, required, AED)
  - `condition` (string/options: New / Excellent / Good / Fair / Poor)
- Show fee preview:
  ```
  Listing Price:     AED 500
  Closeté Fee (12%): AED 60
  Your Earnings:     AED 440
  ```
- Price validation error handling from backend → highlight price field

**Step 4: Publish**
- Call `POST /products` (multipart: `data` JSON field + `image` file + `doc` file for proof of purchase)
- On success: "Your item is live!" screen with earnings breakdown + "Sell Another" button

### 8.6 Order / Checkout Module

#### Order Status Enum (CRITICAL — backend is SOURCE OF TRUTH)

```dart
enum OrderStatus {
  pendingPayment,    // 'pending_payment'
  secured,           // 'secured'
  collectionPending, // 'collection_pending'
  collected,         // 'collected'
  verification,      // 'verification'
  payoutProcessing,  // 'payout_processing'
  readyForDelivery,  // 'ready_for_delivery'
  delivered,         // 'delivered'
  completed,         // 'completed'
  refunded,          // 'refunded'
  cancelled,         // 'cancelled'
}
```

⚠️ **Strict State Machine (Backed-enforced)** — invalid transitions are rejected with 400 Bad Request. UI must disable invalid transitions. Allowed forward transitions only:

```
pending_payment  → [secured]
secured          → [collection_pending, cancelled]
collection_pending → [collected, cancelled]
collected        → [verification]
verification     → [payout_processing, refunded]
payout_processing → [ready_for_delivery]
ready_for_delivery → [delivered]
delivered        → [completed]
completed        → [] (terminal)
refunded         → [] (terminal)
cancelled        → [] (terminal)
```

```dart
extension OrderStatusX on OrderStatus {
  String get snakeCase => switch (this) {
    OrderStatus.pendingPayment => 'pending_payment',
    OrderStatus.collectionPending => 'collection_pending',
    OrderStatus.payoutProcessing => 'payout_processing',
    OrderStatus.readyForDelivery => 'ready_for_delivery',
    _ => name,
  };

  String get displayLabel => switch (this) {
    OrderStatus.pendingPayment => 'Pending Payment',
    OrderStatus.secured => 'Secured',
    OrderStatus.collectionPending => 'Awaiting Collection',
    OrderStatus.collected => 'Collected',
    OrderStatus.verification => 'Authenticating',
    OrderStatus.payoutProcessing => 'Payout Processing',
    OrderStatus.readyForDelivery => 'Ready for Delivery',
    OrderStatus.delivered => 'Delivered',
    OrderStatus.completed => 'Completed',
    OrderStatus.refunded => 'Refunded',
    OrderStatus.cancelled => 'Cancelled',
  };

  List<OrderStatus> get allowedNext => switch (this) {
    OrderStatus.pendingPayment => [OrderStatus.secured],
    OrderStatus.secured => [OrderStatus.collectionPending, OrderStatus.cancelled],
    OrderStatus.collectionPending => [OrderStatus.collected, OrderStatus.cancelled],
    OrderStatus.collected => [OrderStatus.verification],
    OrderStatus.verification => [OrderStatus.payoutProcessing, OrderStatus.refunded],
    OrderStatus.payoutProcessing => [OrderStatus.readyForDelivery],
    OrderStatus.readyForDelivery => [OrderStatus.delivered],
    OrderStatus.delivered => [OrderStatus.completed],
    _ => const [],
  };
}
```

#### Order Model

```dart
@freezed
class OrderModel with _$OrderModel {
  const factory OrderModel({
    required String orderNumber,
    @ProductModelConverter() required ProductModel product,  // populated
    @UserBriefConverter() required UserBrief buyer,          // populated: name/email/contact
    @UserBriefConverter() required UserBrief seller,         // populated
    required double price,
    required double platformFee,
    required double sellerPayout,
    required DeliveryDetailsModel deliveryDetails,
    required OrderPaymentModel payment,
    required PayoutStatus payoutStatus,
    required OrderStatus status,
    required List<OrderStatusHistoryEntry> statusHistory,
  }) = _OrderModel;
}

@freezed
class OrderPaymentModel with _$OrderPaymentModel {
  const factory OrderPaymentModel({
    required String provider,      // 'stripe'
    required String paymentIntentId,
    required PaymentStatus status, // pending | paid | failed | refunded
  }) = _OrderPaymentModel;
}
```

#### Checkout Flow (Buyer Side)

From Product Detail → "Secure This Item":

1. **Delivery Address Form**
   - Fields: `address`, `location` (city/area), `phone`
   - Call: `POST /orders/:productId/checkout`
   - Body: `{ "deliveryDetails": { "address": "...", "location": "...", "phone": "..." } }`
   - **Response `data`:** `{ order: OrderModel, clientSecret: string }`
     - `clientSecret` is the **Stripe PaymentIntent Client Secret** (NOT the paymentIntentId). It is `paymentIntent.client_secret` returned from Stripe. Flutter Stripe PaymentSheet requires THIS value.

2. **Stripe Payment Confirmation** (see Payment Section 11)
   - Use `flutter_stripe` `PaymentSheet` initialized with `response.data.clientSecret`
   - Support: Card, Apple Pay (iOS), Google Pay (Android)

3. **Order Confirmation Screen**
   - After Stripe confirmation: Poll `GET /orders/:id` every 3s (max 10 times) until order.status != PENDING_PAYMENT, OR wait for socket event. Stripe webhook → backend updates payment status → order status becomes `SECURED` and product → `secured`.
   - Show status timeline starting at current status.

#### Order List: `GET /orders`

- Query param: `?role=buyer` (**default** if omitted) | `?role=seller`
  ⚠️ **No "both" option.** Use two separate API calls to render "combined" view on Profile home, or split into two tabs (Purchases tab → role=buyer, Wardrobe tab → role=seller via product listings; orders seller-view → role=seller).
- Tabs in Profile: My Purchases (role=buyer list of orders), My Wardrobe/Listings (separate `GET /products?seller=<userId>` OR `role=seller` orders list based on UX)
- Each order card: product image, order #, status chip, price, date

#### Order Detail: `GET /orders/:id`

- Status timeline with dates (use `statusHistory`)
- Seller/Buyer info (populated) based on role
- "Contact Support" → mailto: or support chat
- **Cancel Order (Buyer ONLY):** POST `/orders/:id/cancel`
  ⚠️ **Only allowed when status = `SECURED` (NOT `PENDING_PAYMENT`).** Disable Cancel button otherwise.
  If cancelled, Stripe refund auto-triggered and product re-listed (status available).

### 8.7 User / Profile Module

`UserModel` — fields mirror `IUser` in backend:

```dart
@freezed
class UserModel with _$UserModel {
  const factory UserModel({
    required String id,
    required String name,
    required UserRole role,
    String? contact,
    required String email,
    String? location,
    String? image,          // avatar/profile image URL
    String? avatar,
    String? provider,       // 'local' | 'google'
    String? providerId,
    required UserStatus status,
    required bool verified,
  }) = _UserModel;
}

enum UserRole { SUPER_ADMIN, ADMIN, USER }
enum UserStatus { active, ban }
```

#### Endpoints

| Action | Call |
|--------|------|
| Load my profile | `GET /user/profile` (JWT from auth) |
| Update profile | `PATCH /user/profile` (multipart. Supports BOTH patterns: (a) form field `data` = JSON of partial user object OR (b) flat form fields + `image` multipart file). Multipart field names: `image` = avatar upload |
| Delete account | `DELETE /user/profile` (confirm dialog, then logout) |

**Profile header stats** (itemsListed, purchasesCount, closetValue):
- Backend may not yet expose as aggregated fields in `/profile` response.
- Compute client-side: wardrobes listings + purchases order sums for now.

### 8.8 Issues / Disputes (Admin-only in backend)

Mobile user-facing: "Contact Support" CTA → email support. Issue endpoints are **ADMIN/SUPER_ADMIN only** (operations dashboard). Request body shapes if used in admin web view:

| Endpoint | Body |
|----------|------|
| `POST /issues` | `{ productId:string, issueType: 'buyer_refused'\|'verification_failed', reason:string }` (NOT orderId-based) |
| `PATCH /issues/:id/resolve` | `{ action: 'delete'\|'make_available' }` (NOT resolution=approved/rejected) |

---

## 9. File Upload & Media Handling

### Backend Upload Architecture (from fileUploadHandler.ts)

Three **allowed multipart field names** (any other name → 400 "File is not supported"):

| Field Name | Mime Types | Max Count | Use Case |
|-----------|-----------|-----------|----------|
| `image` | jpeg/png/jpg only | 3 files | Product photos, user avatar, AI listing photo |
| `media` | video/mp4, audio/mpeg only | 3 | Product videos (future) |
| `doc` | application/pdf only | 3 | Proof of purchase PDF, documents |

All files are saved locally to disk by multer, then uploaded to S3 by controllers (and local copies deleted). Controller returns S3 URLs in response.

### Two Upload Patterns in Backend

#### Pattern A — JSON in `data` form field + files (Products)

Used for: `POST /products` and `PATCH /user/profile` (route middleware supports both patterns)

```
Content-Type: multipart/form-data

Field "data": string (JSON.stringify of your body object)
Files: "image[0]", "image[1]", ... or "image" (single) + "doc[0]" (proof-of-purchase)
```

**Fallback for Pattern A (both routes):** If `data` field is absent, backend accepts **flat individual form fields** directly (so client can send `name=...`, `price=...`, etc as separate form entries instead of `data={json}`). Both work; prefer the flat fields for simplicity.

**Example for creating a product:**
```dart
Future<ApiResponse<ProductModel>> createProduct({
  required String name,
  required String brand,
  required double price,
  required String condition,
  required String description,
  required XFile mainImage,
  XFile? proofOfPurchasePdf,
}) async {
  final formData = FormData();

  // Option 1 — Flat fields (recommended — simpler, no JSON serialization needed):
  formData.fields.addAll([
    MapEntry('name', name),
    MapEntry('brand', brand),
    MapEntry('price', price.toString()),
    MapEntry('condition', condition),
    MapEntry('description', description),
  ]);

  // Option 2 — data field (also works):
  // formData.fields.add(MapEntry('data', jsonEncode({
  //   'name': name, 'brand': brand, 'price': price, ...
  // })));

  formData.files.add(MapEntry(
    'image',
    await MultipartFile.fromFile(mainImage.path, filename: 'photo.jpg'),
  ));

  if (proofOfPurchasePdf != null) {
    formData.files.add(MapEntry(
      'doc',
      await MultipartFile.fromFile(proofOfPurchasePdf.path, filename: 'receipt.pdf'),
    ));
  }

  final resp = await _dio.post('/products', data: formData);
  return ApiResponse.fromJson(resp.data, (d) => ProductModel.fromJson(d as Map<String, dynamic>));
}
```

#### Pattern B — Direct file field, no JSON, no body (AI Analysis)

Used for: `POST /ai/analyze-listing`

```
Content-Type: multipart/form-data
Form field name: "image" (first element of array; only image[0] used)
No other fields.
```

```dart
Future<ApiResponse<AiAnalysisResult>> analyzeListing(XFile photo) async {
  final formData = FormData.fromMap({
    'image': await MultipartFile.fromFile(photo.path, filename: 'listing.jpg'),
  });
  final resp = await _dio.post('/ai/analyze-listing', data: formData);
  return ApiResponse.fromJson(resp.data, (d) => AiAnalysisResult.fromJson(d as Map<String, dynamic>));
}
```

#### PATCH Requests — When NOT to Use Multipart
⚠️ `PATCH /products/:id` uses `validateRequest(updateProductZodSchema)` — **no file upload middleware.** This endpoint accepts ONLY `Content-Type: application/json` body. To update a product's image, future enhancement would need a dedicated `POST /products/:id/image` route. Today: recreate the listing for photo changes.

### AI Analysis Result Model (Full fields)

```dart
@freezed
class AiAnalysisResult with _$AiAnalysisResult {
  const factory AiAnalysisResult({
    required String imageUrl,              // S3 URL of uploaded photo
    required String? brand,                // Detected brand
    required String? category,             // e.g. "Handbag", "Sneakers"
    required String? condition,            // "New" | "Excellent" | "Good" | "Fair" | "Poor"
    required String? description,          // AI-generated description paragraph
    required double? suggestedPrice,       // In AED
    required double? authenticityConfidence, // 0-100 (percent genuine confidence)
    required Map<String, String> attributes, // e.g. {"color":"Black","material":"Leather","size":"42","hardware":"Gold"}
  }) = _AiAnalysisResult;

  factory AiAnalysisResult.fromJson(Map<String, dynamic> json) =>
      _$AiAnalysisResultFromJson(json);
}
```

### Image Display

- All product/user images are URLs to S3/CloudFront. Use `CachedNetworkImage`:
  ```dart
  CachedNetworkImage(
    imageUrl: product.image,
    placeholder: (_, __) => const ShimmerImage(),
    errorWidget: (_, __, ___) => const Icon(Icons.broken_image, size: 48),
    fit: BoxFit.cover,
  );
  ```
- Full-screen tap for product images → `PhotoViewGallery`.

---

## 10. Socket.io for Real-time Updates

Backend has Socket.io scaffolded (`socketHelper.ts`). Order status updates should be pushed to buyer & seller.

### Socket Service

```dart
// services/socket_service.dart
@singleton
class SocketService {
  final AppConfig _config;
  final SecureStorage _storage;
  late io.Socket _socket;
  final _statusUpdate = StreamController<OrderStatusUpdate>.broadcast();
  Stream<OrderStatusUpdate> get onOrderStatusUpdate => _statusUpdate.stream;

  SocketService(this._config, this._storage);

  bool _connected = false;

  Future<void> connect() async {
    if (_connected) return;
    final token = await _storage.getAccessToken();
    _socket = io.io(_config.socketUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'extraHeaders': {
        if (token != null) 'Authorization': 'Bearer $token',
      },
    });
    _socket.onConnect((_) => _connected = true);
    _socket.onDisconnect((_) => _connected = false);
    _socket.on('order:status_updated', (data) {
      final update = OrderStatusUpdate.fromJson(Map<String, dynamic>.from(data as Map));
      _statusUpdate.add(update);
    });
    _socket.connect();
  }

  void disconnect() {
    _socket.disconnect();
    _connected = false;
  }

  void joinUserRoom(String userId) {
    _socket.emit('join', {'room': 'user:$userId'});
  }
}
```

⚠️ **Confirm with backend**: exact event names (here assumed: `order:status_updated`), room joining mechanism, and server-side `join` event handler. These are not yet implemented in current backend code; sockets is scaffolded only. Plan UI to gracefully fall back to polling every 10-15s if socket events don't arrive.

**Usage in OrderDetailScreen:**
- Subscribe to `onOrderStatusUpdate` where order.id matches
- Update status timeline in real-time; show in-app banner for status change

---

## 11. Payment Integration (Stripe)

Backend uses `stripe` SDK + creates PaymentIntent as part of checkout (`POST /orders/:productId/checkout`).

### Stripe Payment Keys
- Publishable key (mobile): `pk_test_xxx` / `pk_live_xxx`
- Server secret key (backend only): never goes in mobile app

### Checkout → Payment Confirmation Flow (Stripe PaymentSheet)

```
Press "Secure This Item (AED XXXX)"
  ↓
POST /orders/:productId/checkout
  Returns: data.order + data.clientSecret (Stripe PaymentIntent client_secret)
  ↓
Initialize PaymentSheet with clientSecret from data.clientSecret
  (NOT order.payment.paymentIntentId — that's only the Stripe ID; PaymentSheet needs clientSecret)
  ↓
Stripe.instance.presentPaymentSheet()
  ↓ Success →
    Mark local UI state as processing
    Poll GET /orders/:id every 3s (backend listens to Stripe webhook and updates order.payment.status=paid + status=SECURED)
    Once order.status != PENDING_PAYMENT → show Order Confirmation screen
  ↓ Failure →
    Show error, allow retry
```

### Flutter Setup (flutter_stripe)

1. Initialize Stripe in `main()`:
   ```dart
   Stripe.publishableKey = config.stripePublishableKey;
   Stripe.merchantIdentifier = 'merchant.app.closete';
   Stripe.urlScheme = 'closete';
   await Stripe.instance.applySettings();
   ```

2. Checkout button flow:
   ```dart
   Future<void> confirmPayment(String stripeClientSecret) async {
     await Stripe.instance.initPaymentSheet(
       paymentSheetParameters: SetupPaymentSheetParameters(
         paymentIntentClientSecret: stripeClientSecret,  // ← from data.clientSecret!
         merchantDisplayName: 'Closeté',
         style: ThemeMode.light,
         applePay: const PaymentSheetApplePay(merchantCountryCode: 'AE'),
         googlePay: const PaymentSheetGooglePay(
           merchantCountryCode: 'AE',
           currencyCode: 'AED',
           testEnv: true, // false for production
         ),
       ),
     );
     try {
       await Stripe.instance.presentPaymentSheet();
       emit(const CheckoutState.success());
     } on StripeException catch (e) {
       emit(CheckoutState.failure(e.error.localizedMessage));
     }
   }
   ```

3. For **saved cards** — backend endpoints `GET /payment-methods`, `POST /payment-methods` NOT yet implemented (only webhook exists). Hide "Saved Cards" UI for now until backend adds PaymentMethod CRUD + SetupIntent endpoints.

---

## 12. Error Handling & User Feedback

### Failure → UI Mapping

| Failure Type | UI Presentation |
|--------------|-----------------|
| `ServerFailure` with single empty-path errorMessage | Snackbar with `message` |
| `ServerFailure` with path-scoped errorMessages (Zod validation) | Inline red text on each form field matched by `path` |
| `UnauthorizedFailure` / JWT `TokenExpiredError` | **Force logout** + dialog: "Session expired. Please login again." |
| `NetworkFailure` | Offline banner at top of screen (persistent) + Retry CTA |
| `TimeoutFailure` | Snackbar: "Slow connection. Please try again." + Retry |
| 400 "Cannot move order from X to Y" | Dialog showing allowed next status (state machine rejection) |

### Form Validation

Use `formz` package for type-safe validation inputs:

```dart
class Email extends FormzInput<String, String> {
  const Email.pure() : super.pure('');
  const Email.dirty([super.value = '']) : super.dirty();

  static final RegExp _regex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$');

  @override
  String? validator(String value) {
    if (value.isEmpty) return 'Email is required';
    if (!_regex.hasMatch(value)) return 'Invalid email format';
    return null;
  }
}
```

### Loading Overlay

Show modal progress indicator during network calls (login, checkout) to prevent double-submit:

```dart
class LoadingOverlay extends StatelessWidget {
  final bool isLoading;
  final Widget child;
  const LoadingOverlay({super.key, required this.isLoading, required this.child});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        child,
        if (isLoading)
          const Opacity(
            opacity: 0.6,
            child: ModalBarrier(dismissible: false, color: Colors.black),
          ),
        if (isLoading)
          const Center(child: CircularProgressIndicator()),
      ],
    );
  }
}
```

---

## 13. Navigation & Routing

Use `go_router` with redirects based on auth state:

```dart
@injectable
class AppRouter {
  final AuthBloc _authBloc;
  AppRouter(this._authBloc);

  late final router = GoRouter(
    refreshListenable: GoRouterRefreshStream(_authBloc.stream),
    initialLocation: '/splash',
    routes: [
      GoRoute(path: '/splash', builder: (_, __) => const SplashPage()),
      GoRoute(path: '/onboarding', builder: (_, __) => const OnboardingPage()),
      GoRoute(
        path: '/auth/login',
        builder: (_, __) => const LoginPage(),
        routes: [
          GoRoute(path: 'register', builder: (_, __) => const RegisterPage()),
          GoRoute(path: 'verify', builder: (_, s) => VerifyEmailPage(
            email: s.uri.queryParameters['email'] ?? '',
            resetFlow: s.uri.queryParameters['reset'] == '1',
          )),
          GoRoute(path: 'forget', builder: (_, __) => const ForgetPasswordPage()),
          GoRoute(path: 'reset', builder: (_, s) => ResetPasswordPage(
            // cryptoResetToken passed via transient state (NOT query param for security, but accepted)
            token: s.extra as String? ?? s.uri.queryParameters['token'] ?? '',
          )),
        ],
      ),
      StatefulShellRoute.indexedStack(
        builder: (_, __, navigationShell) => HomeShell(navigationShell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (_, __) => const HomePage(),
              routes: [
                GoRoute(path: 'product/:id', builder: (_, s) => ProductDetailPage(
                  productId: s.pathParameters['id']!,
                )),
                GoRoute(path: 'sell', builder: (_, __) => const SellFlowRoot()),
              ],
            ),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/wishlist', builder: (_, __) => const WishlistPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/sell-entry', builder: (_, __) => const SellFlowRoot())]),
          StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (_, __) => const OrdersPage())]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/profile', builder: (_, __) => const ProfilePage(),
              routes: [
                GoRoute(path: 'wardrobe', builder: (_, __) => const WardrobePage()),
                GoRoute(path: 'purchases', builder: (_, __) => const PurchasesPage()),
                GoRoute(path: 'settings', builder: (_, __) => const SettingsPage()),
                GoRoute(path: 'edit', builder: (_, __) => const EditProfilePage()),
              ],
            ),
          ]),
        ],
      ),
      GoRoute(
        path: '/checkout/:productId',
        builder: (_, s) => CheckoutPage(productId: s.pathParameters['productId']!),
      ),
    ],
    redirect: (context, state) {
      final authState = _authBloc.state;
      final loggingIn = state.matchedLocation.startsWith('/auth') || state.matchedLocation == '/splash' || state.matchedLocation == '/onboarding';
      return authState.maybeWhen(
        authenticated: (_) => loggingIn ? '/home' : null,
        orElse: () => loggingIn ? null : '/auth/login',
      );
    },
  );
}
```

---

## 14. Form Validation (Deep Dive)

Mirror **backend Zod schemas exactly**:

| Field | Client Validation (UX) | Backend Zod Enforces |
|-------|-----------|----------------------|
| `email` | Non-empty, valid format | ✅ Required, email format |
| `password` (register/login) | Non-empty, min 6 chars | ✅ Required only — no min enforced on backend yet; add client-side only for UX |
| `confirmPassword` | Equals password | ✅ Required; equality checked in service layer |
| `currentPassword` (change pwd) | Non-empty | ✅ Required; equality checked in service layer |
| `oneTimeCode` | Exactly 6 digits, numeric | ✅ Required (type: `number`) — if string sent, coerce to number. Note: service expects `number` type not string! |
| `contact` / `phone` | Non-empty | ✅ Required on both user (contact) and order deliveryDetails (phone) |
| `location` / deliveryDetails.location | Non-empty | ✅ Required |
| `address` (delivery) | Non-empty | ✅ Required |
| `name` (user) | Non-empty, ≤ 80 chars | ✅ Required |
| `product.name` | Non-empty | ✅ Required |
| `product.brand` | Non-empty | ✅ Required |
| `product.description` | Non-empty | ✅ Required |
| `product.price` | > 0, number, not string | ✅ Required, type `number`. Multer path converts string → Number() in route; prefer send number for JSON |
| `product.condition` | Non-empty | ✅ Required |
| `issue.reason` | Non-empty | ✅ Required |

**Key principles:**
- Client validation = UX friendly (fast feedback). Server validation = trust source.
- Server `errorMessages[].path` maps 1-to-1 with form field names. Attach errors to matching inputs.
- `oneTimeCode` backend expects `number` (int) — send as integer in JSON, not string.

---

## 15. Testing Strategy

| Layer | Tools | Coverage Target |
|-------|-------|-----------------|
| Models (fromJson/toJson) | `flutter_test` | 100% of models |
| Repository (failure mapping, Either folding) | `mockito` | 80% |
| Blocs/Cubits | `bloc_test` | 90% of business logic |
| Widgets | `flutter_test` | Critical screens 70%+ |
| End-to-end | `patrol` (recommended over integration_test) | Auth + Checkout flows |

**Use `build_runner` watch during development:**
```bash
flutter pub run build_runner watch --delete-conflicting-outputs
```

---

## 16. Performance & Best Practices

### Critical Do's

- ✅ **const constructors** everywhere possible (ListView items, widgets)
- ✅ Use `ListView.builder` / `GridView.builder` for ALL lists
- ✅ `const EdgeInsets`, `const SizedBox`
- ✅ Debounce `searchTerm` text field input: 300ms delay before API call
- ✅ Paginate ALL list endpoints (page/limit pattern)
- ✅ Images: `CachedNetworkImage` with placeholder/error widgets
- ✅ Prevent double-submit: disable button during `inProgress` state
- ✅ Token refresh: single-flight (`_refreshInFlight` lock to prevent concurrent refreshes)
- ✅ Payment: verify the `clientSecret` is correct from checkout response before initializing Stripe

### Critical Don'ts

- ❌ Don't rebuild entire screens — scope Blocs per feature/sub-tree
- ❌ Don't call `setState` for network state
- ❌ Don't store passwords in plain text (never log them!)
- ❌ Don't assume network is available; gracefully degrade
- ❌ Don't hardcode 12% fee value → use computed `platformFee` from backend
- ❌ Don't hardcode OrderStatus timeline ordering; derive from state machine & `statusHistory`
- ❌ Don't parse JSON without models (no `Map<String, dynamic>` in business logic)
- ❌ Don't add `Bearer ` prefix to reset-password Authorization header (raw token only!)

### Image Optimization

- Use `image_picker` with `imageQuality: 80` and `maxWidth: 1600` (reduce upload size)
- If video support added: compress via `flutter_video_compress` before upload
- Display: use appropriate `memCacheWidth`/`memCacheHeight` on `CachedNetworkImage` based on widget size

---

## 17. Appendix: Full API Reference

> Base path: `/api/v1`
> Default `Content-Type: application/json` unless stated otherwise
> Auth column = required roles; empty = public
> ⚠️ = verified during backend audit; do NOT deviate

### 17.1 Authentication (`/auth`)

| Method | Path | Auth | Request | Response `data` | Notes |
|--------|------|------|---------|-----------------|-------|
| POST | `/auth/login` | — | JSON: `{ email:string, password:string }` | `{ accessToken:string, refreshToken:string }` | Rate limited. 400 if unverified or banned or wrong password |
| POST | `/auth/forget-password` | — | JSON: `{ email:string }` | null | OTP emailed. Rate limited. |
| POST | `/auth/verify-email` | — | JSON: `{ email:string, oneTimeCode:number ⚠️ }` | `string? cryptoResetToken` or null | Dual-purpose: (a) unverified user → activates account, data=null; (b) forget-password → returns raw crypto reset token as `data` for use in reset-password header |
| POST | `/auth/reset-password` | Header only (no JWT, no Bearer) | JSON: `{ newPassword, confirmPassword }` | null | ⚠️ `Authorization: <rawCryptoToken>` (NO Bearer prefix). Token = result of verify-email forget-password step |
| POST | `/auth/change-password` | USER, ADMIN (JWT Bearer) | JSON: `{ currentPassword, newPassword, confirmPassword }` | null | Must know old password |
| POST | `/auth/resend-otp` | USER (JWT Bearer) | {} empty (email from JWT claims) | `{ message }` | ⚠️ BROKEN for new unverified users — they can't obtain JWT (login blocked). Backend needs public email variant. Rate limited. |
| POST | `/auth/refresh-token` | — | JSON: `{ refreshToken:string }` | `{ accessToken:string }` | Use when access token returns 401 |

### 17.2 User (`/user`)

| Method | Path | Auth | Body | Response `data` |
|--------|------|------|------|----------|
| GET | `/user/profile` | USER, ADMIN, SUPER_ADMIN (JWT) | — | `UserModel` |
| PATCH | `/user/profile` | USER, ADMIN, SUPER_ADMIN (JWT) | **multipart**: form field `data` = JSON of `{name?, email?, password?, image?}` **OR** flat form fields directly + multipart file field `image` (avatar/jpg/png). Middleware auto-selects pattern | Updated `UserModel` |
| DELETE | `/user/profile` | USER, ADMIN, SUPER_ADMIN (JWT) | — | Deletes account |
| GET | `/user/` | ADMIN, SUPER_ADMIN | query: page/limit/searchTerm/sort | Paginated list of all users (admin view) |
| POST | `/user/` | Public (rate limited) | JSON: `{ name:string, email:string, password:string, contact:string, location:string, profile?:string }` | Created `UserModel` (registration endpoint). User NOT auto-verified. Proceed to /auth/verify-email with emailed OTP. |

### 17.3 OAuth (`/oauth`)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/oauth/google` | — | Redirects to Google consent screen. For Flutter mobile: launch via `url_launcher` (use `flutter_web_auth` + `CUSTOM Tab / ASWebAuthenticationSession`). Handles full OAuth flow server-side. |
| GET | `/oauth/google/callback` | — | (Backend-only, called by Google). After auth, **backend redirects to `FRONTEND_OAUTH_CALLBACK_URL` with query params:** `?accessToken=<JWT>&refreshToken=<JWT>&userId=<id>` ⚠️ |
| GET | `/oauth/profile` | JWT Bearer | Current user via OAuth |
| GET | `/oauth/status` | — | `{ google: { configured: bool, name: "Google" } }` — use to decide whether to show "Sign in with Google" button |

**Flutter Google Sign-In deep-link setup:**
- Configure iOS/Android URL scheme for callback (e.g. `closete://oauth-callback`)
- Set backend env `FRONTEND_OAUTH_CALLBACK_URL=closete://oauth-callback` for dev/staging (or your https page for production)
- Catch the redirect via `uni_links` or app_links, parse query params → save tokens (same as email/password login path)

### 17.4 Products (`/products`)

| Method | Path | Auth | Body | Response `data` |
|--------|------|------|------|----------|
| GET | `/products` | Public | Query: `page`, `limit`, `searchTerm`⚠️ (not search), `brand`, `sort`, `fields`, `status` (default=available⚠️), direct filters | `ProductModel[]` + pagination meta. Default shows only `status=available`. |
| POST | `/products` | USER+ (JWT) | **multipart**. Two equivalent options: (a) form field `data` = JSON `{ name, brand, description, price:number, condition }` + files, **OR** (b) flat form fields for each scalar + files. File fields: `image` (jpg/png, required⚠️), optionally `doc` (PDF for proof of purchase). | Created `ProductModel`. Status defaults to `available`. Fee not on product. |
| GET | `/products/:id` | Public | — | Single product detail (seller populated). |
| PATCH | `/products/:id` | USER (owner/seller) + ADMIN | **JSON only⚠️** (no multipart, no file uploads today). Body `{ name?, brand?, description?, price?, condition?, status?: 'available' | 'secured' | 'sold' }` | Updated product. Seller/admin role check in service. |
| DELETE | `/products/:id` | USER (owner) + ADMIN | — | `null`. Deletes images + proof from S3 + DB doc. |

### 17.5 Wishlist (`/wishlist`)

| Method | Path | Auth | Response `data` |
|--------|------|------|----------|
| GET | `/wishlist` | USER+ (JWT) | Products array (wishlist items of current user). |
| POST | `/wishlist/:productId` | USER+ (JWT) | Created wishlist entry. |
| DELETE | `/wishlist/:productId` | USER+ (JWT) | `null` |

### 17.6 Orders (`/orders`)

| Method | Path | Auth | Body | Response `data` |
|--------|------|------|------|----------|
| POST | `/orders/:productId/checkout` | USER (JWT) — buyer only | JSON: `{ deliveryDetails: { address, location, phone } }`. Creates order + Stripe PaymentIntent. | **`{ order: OrderModel, clientSecret: string }`⚠️**. `clientSecret` (Stripe PaymentIntent client_secret) is what you need for `flutter_stripe` PaymentSheet. |
| GET | `/orders` | USER+ (JWT) | Query: `?role=buyer` (default⚠️) \| `?role=seller` + page/limit/sort | Paginated `OrderModel[]`. Products + buyer/seller populated. |
| GET | `/orders/:id` | USER (party to order) + ADMIN | — | Single order. Products/buyer/seller populated. |
| POST | `/orders/:id/cancel` | USER (buyer only) | — | Cancelled order. **Only allowed from status=SECURED⚠️** (not pending_payment). Auto-triggers Stripe refund + product relisted. |
| GET | `/orders/admin/all` | ADMIN, SUPER_ADMIN | Query: page/limit/status/filters | Admin full orders list |
| PATCH | `/orders/:id/status` | ADMIN, SUPER_ADMIN | JSON: `{ status: OrderStatus_snake_case, note?: string }` | Updated order. State machine validates transition. Triggers Stripe refund if target ∈ {cancelled, refunded}. |
| PATCH | `/orders/:id/payout` | ADMIN, SUPER_ADMIN | — | Marks seller payout as paid (manual payout button for ops). Min status required: payout_processing or later. |

### 17.7 AI (`/ai`)

| Method | Path | Auth | Body | Response `data` |
|--------|------|------|------|-----------------|
| POST | `/ai/analyze-listing` | Public (rate limited: 20/15 min) | **multipart**: single field name = `image`⚠️ (jpg/png). Single file. | `AiAnalysisResult`: `{ imageUrl, brand?, category?, condition?, description?, suggestedPrice?, authenticityConfidence: 0-100, attributes: {[k]: v} }` |

### 17.8 Issues (`/issues`) — ADMIN ONLY

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/issues` | ADMIN, SUPER_ADMIN | JSON: `{ productId:string ⚠️ (not orderId), issueType: 'buyer_refused'\|'verification_failed', reason:string }` |
| GET | `/issues` | ADMIN, SUPER_ADMIN | Query: page/limit |
| GET | `/issues/:id` | ADMIN, SUPER_ADMIN | — |
| PATCH | `/issues/:id/resolve` | ADMIN, SUPER_ADMIN | JSON: `{ action: 'delete' \| 'make_available' ⚠️ }` |

### 17.9 Payment

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payment/webhook` | — (Stripe signed only) | Backend webhook. Receives `payment_intent.succeeded` → marks order as paid/SECURED; `payment_intent.payment_failed` → marks payment failed. NOT for mobile client. NEVER call from app. |

---

## Backend Fix Suggestions (for Flutter's sake)

Priority order for backend tweaks that the Flutter team will need early:

1. **[P0]** Add `POST /auth/resend-otp-public` accepting JSON `{ email }` without JWT (rate-limited, same limiter as login). Or relax existing `/resend-otp` auth to allow `?email=` for unverified accounts.
2. **[P1]** Socket.io implementation: add explicit `join('user:<userId>')` handler + emit `order:status_updated` on order status transitions. Today sockets is scaffolded but no event wiring.
3. **[P1]** Add profile-aggregated fields: itemsListed count, purchasesCount, closetValue (AED sum of sellerPayout for completed orders + current listed available product price totals) — saves N+1 client calls.
4. **[P2]** PaymentMethod CRUD endpoints (GET/POST/DELETE `/payment-methods` + SetupIntent creation) for Saved Cards UX.
5. **[P2]** Add `PATCH /products/:id/media` (multipart `image` + `doc` route with fileUploadHandler) to enable editing product images without recreating a listing.
6. **[P3]** Normalize reset-password to use `Authorization: Bearer <resetJWT>` pattern for consistency (currently raw header) to simplify Flutter's interceptor pattern.

---

*This document v1.1 has been line-by-line audited against backend source files (controllers, services, routes, middlewares, enums, integrations, QueryBuilder) and all 14 original mismatches have been corrected + documented with warnings inline (⚠️ symbol). Flutter team can start implementation. Any discrepancy found after testing should be flagged and doc updated.*
