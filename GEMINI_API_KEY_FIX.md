# GEMINI_API_KEY Firebase Deployment 문제 해결 방법

## 문제 설명

Firebase Functions 배포 시 다음과 같은 오류가 발생했습니다:

```
Error: In non-interactive mode but have no value for the following secrets: GEMINI_API_KEY
Set these secrets before deploying:
	firebase functions:secrets:set GEMINI_API_KEY
```

이 문제는 Firebase Functions가 `functions.params.defineSecret("GEMINI_API_KEY")`를 사용하여 시크릿을 정의했지만, GitHub Actions 워크플로우가 배포 전에 이 시크릿을 Google Cloud Secret Manager에 설정하지 않아서 발생했습니다.

## 해결 방법

### 1. GitHub Secrets에 GEMINI_API_KEY 추가 확인

먼저 GitHub 저장소 설정에서 `GEMINI_API_KEY` 시크릿이 추가되어 있는지 확인해야 합니다:

1. GitHub 저장소 → Settings → Secrets and variables → Actions
2. `GEMINI_API_KEY` 시크릿이 있는지 확인
3. 없다면 "New repository secret" 버튼을 클릭하여 추가

### 2. GitHub Actions 워크플로우 수정

`.github/workflows/firebase-deploy.yml` 파일에 다음 두 가지 변경 사항을 추가했습니다:

#### 변경 1: 시크릿 검증에 GEMINI_API_KEY 추가

```yaml
- name: Validate Firebase secrets (fail if any is missing)
  run: |
    check() { [ -n "$1" ] || { echo "::error::Missing secret $2"; exit 1; }; }
    check "${{ secrets.FB_API_KEY }}" FB_API_KEY
    check "${{ secrets.FB_AUTH_DOMAIN }}" FB_AUTH_DOMAIN
    check "${{ secrets.FB_PROJECT_ID }}" FB_PROJECT_ID
    check "${{ secrets.FB_STORAGE_BUCKET }}" FB_STORAGE_BUCKET
    check "${{ secrets.FB_MESSAGING_SENDER_ID }}" FB_MESSAGING_SENDER_ID
    check "${{ secrets.FB_APP_ID }}" FB_APP_ID
    check "${{ secrets.GCP_SA_KEY }}" GCP_SA_KEY
    check "${{ secrets.FIREBASE_PROJECT_ID }}" FIREBASE_PROJECT_ID
    check "${{ secrets.GEMINI_API_KEY }}" GEMINI_API_KEY  # 추가됨
```

#### 변경 2: 배포 전 Firebase Functions 시크릿 설정 단계 추가

Google Cloud 인증 후, Firebase 배포 전에 새로운 단계를 추가했습니다:

```yaml
# Set Firebase Functions secrets before deployment
- name: Set Firebase Functions secrets
  env:
    FIREBASE_PROJECT_ID: ${{ secrets.FIREBASE_PROJECT_ID }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  run: |
    if [ -d "functions" ]; then
      echo "Setting GEMINI_API_KEY secret..."
      echo "$GEMINI_API_KEY" | firebase functions:secrets:set GEMINI_API_KEY --project "$FIREBASE_PROJECT_ID" --force
    fi
```

## 작동 원리

1. **검증 단계**: 워크플로우가 시작될 때 모든 필요한 GitHub Secrets가 설정되어 있는지 확인합니다.

2. **시크릿 설정 단계**: Firebase 배포 전에 `firebase functions:secrets:set` 명령을 사용하여 GEMINI_API_KEY를 Google Cloud Secret Manager에 자동으로 설정합니다.

3. **배포 단계**: 이제 Firebase Functions 배포 시 필요한 시크릿이 이미 설정되어 있으므로 오류 없이 배포가 진행됩니다.

## 필수 조건

이 솔루션이 작동하려면 다음이 필요합니다:

1. **GitHub Secrets 설정**: `GEMINI_API_KEY` 시크릿이 GitHub 저장소 설정에 추가되어 있어야 합니다.

2. **GCP 서비스 계정 권한**: `GCP_SA_KEY`로 인증된 서비스 계정이 Secret Manager에 시크릿을 생성하고 수정할 수 있는 권한이 있어야 합니다:
   - `roles/secretmanager.admin` 또는
   - `roles/secretmanager.secretAccessor` + `roles/secretmanager.secretVersionManager`

3. **Firebase CLI**: 워크플로우에서 Firebase CLI가 설치되어 있어야 합니다 (이미 설정됨).

## 테스트

변경 사항을 main 브랜치에 머지하면 GitHub Actions가 자동으로 실행되며:

1. GEMINI_API_KEY가 있는지 확인
2. Google Cloud에 인증
3. GEMINI_API_KEY를 Firebase Functions 시크릿으로 설정
4. Firebase Hosting과 Functions 배포

모든 단계가 성공적으로 완료되면 배포가 완료됩니다.

## 추가 참고 사항

- `--force` 플래그는 시크릿이 이미 존재하는 경우 덮어쓰기를 허용합니다.
- 시크릿은 Google Cloud Secret Manager에 안전하게 저장됩니다.
- Functions 코드에서는 `GEMINI_API_KEY.value()`를 호출하여 시크릿 값에 액세스할 수 있습니다.

## 관련 파일

- `.github/workflows/firebase-deploy.yml`: 수정된 워크플로우 파일
- `functions/index.js`: GEMINI_API_KEY를 사용하는 Functions 코드
