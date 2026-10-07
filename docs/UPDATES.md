# 서버 업데이트

관리자는 설정 → 업데이트에서 설치 방식, 현재 버전과 새 버전을 확인하고 업데이트할 수 있다. 버전은 Git 커밋 또는 Docker 이미지 ID로 표시한다. 업데이트 도구는 MOA를 설치한 호스트에서 Node.js 22 이상으로 실행한다.

## 명령행

저장소 루트에서 실행한다.

```sh
node scripts/update.mjs check
node scripts/update.mjs apply
```

`--cwd /설치/경로`, `--dir /상태/경로`, `--mode auto|git|docker`를 지정할 수 있다. 기본 상태 경로는 설치 폴더의 `data/updater`이다. `auto`는 실행 중인 MOA Compose 프로젝트가 있으면 Docker, 아니면 Git을 선택한다. Docker가 중지된 설치는 `--mode docker`로 지정한다.

Git 설치는 현재 브랜치에 설정된 추적 브랜치를 가져와 비교한다. 새 커밋이 있으면 fast-forward 병합하고 잠금 파일에 맞춰 의존성을 설치한 뒤 빌드한다. 수정한 추적 파일이 있거나 기록이 갈라졌다면 업데이트를 중단한다. 원격보다 앞선 로컬 커밋을 되돌리지 않는다.

Git 저장소에서 운영하는 Docker 설치는 같은 방식으로 소스를 갱신하고 이미지를 빌드한 다음 컨테이너를 재생성한다. 빌드에 실패하면 실행 중인 컨테이너를 교체하지 않으며 다음 실행에서 빌드를 다시 시도한다. Git 없이 Compose 이미지만 운영하면 설정된 이미지 태그를 내려받아 실행 중인 이미지 ID와 비교한다. 이 경우 **확인 단계에도 이미지 다운로드가 발생한다**. 이미지를 고정한 태그나 digest를 쓰면 지정한 버전만 사용한다.

Compose 프로젝트 이름, `.env`, `COMPOSE_FILE`과 기존 volume 설정을 유지한다. 초기 실행에 `-p`나 `-f`를 사용했다면 도구에도 같은 구성을 환경 변수로 전달한다.

```sh
COMPOSE_PROJECT_NAME=moa COMPOSE_FILE=compose.yaml:compose.vaapi.yaml node scripts/update.mjs apply --mode docker
```

일반 Git 서버는 빌드 후 `restart-required`를 표시하므로 실행 중인 MOA를 재시작한다. Linux에서 systemd로 운영한다면 호스트 도구에 `MOA_UPDATE_SERVICE=moa.service`를 설정해 자동 재시작할 수 있다. 도구 실행 계정에 해당 서비스의 재시작 권한이 있어야 한다.

수동으로 MOA를 재시작한 뒤에는 호스트 도구도 재시작해 재시작 알림을 지운다. 빌드에 실패해도 먼저 실행 중인 서비스를 중지하지 않는다. 실패한 소스 버전은 기록해 두므로 다시 확인한 뒤 설치를 재시도할 수 있다.

## 웹 설정에서 실행

호스트 도구를 `serve`로 실행하면 웹 관리자 화면의 확인·업데이트 요청을 처리한다. 브라우저에서 실행할 명령이나 파일 경로를 지정할 수 없다. 앱 컨테이너에는 상태 디렉터리만 연결하며 Docker socket이나 Git 저장소를 연결하지 않는다.

### Docker Compose

Linux 예시다. 설치 계정이 소유한 폴더에 해당 계정의 기본 그룹을 지정하고, 앱에도 같은 그룹 접근 권한을 부여한다. 다른 사용자가 이 그룹을 공유하지 않는지 확인한다.

```sh
mkdir -p data/updater
sudo chown "$(id -u):$(id -g)" data/updater
sudo chmod 2770 data/updater
id -g
```

기존 `.env`에 다음 설정을 추가한다. `MOA_UPDATER_GID`의 `1000`은 위 `id -g`의 출력값으로 바꾼다. `COMPOSE_FILE`에 기존 overlay가 있다면 그대로 두고 `compose.updates.yaml`을 마지막에 추가한다. `MOA_UPDATER_PATH`는 호스트의 절대 경로다.

```dotenv
MOA_UPDATER_PATH=/srv/moa/data/updater
MOA_UPDATER_GID=1000
COMPOSE_FILE=compose.yaml:compose.updates.yaml
```

컨테이너를 재생성하고 호스트에서 도구를 실행한다. 호스트 Node.js는 Compose의 `.env`를 자동으로 읽지 않으므로 같은 경로를 `--dir`로 지정한다. Compose 자체의 변수는 기존 `.env`에서 읽는다.

```sh
docker compose up -d --pull never
node scripts/update.mjs serve --cwd /srv/moa --dir /srv/moa/data/updater --mode docker
```

호스트의 서비스 관리자에 이 명령을 등록하면 재부팅 후에도 사용할 수 있다. 호스트 계정은 설치 폴더와 Docker Compose 프로젝트를 관리할 권한이 필요하다. 상태 디렉터리는 앱과 도구만 읽고 쓸 수 있게 유지한다.

### Git 서버

MOA 서버와 호스트 도구가 같은 상태 디렉터리에 접근하게 한다.

```sh
MOA_DEPLOYMENT=git MOA_REVISION=$(git rev-parse HEAD) MOA_UPDATER_DIR="$PWD/data/updater" corepack pnpm --filter @moa/server start
```

다른 터미널이나 서비스에서 실행한다.

```sh
node scripts/update.mjs serve --mode git
```

도구가 종료되거나 상태 갱신이 끊기면 웹의 실행 버튼이 비활성화된다. 빌드와 재시작 중에는 재생과 접속이 잠시 중단될 수 있다. 앱·인증 데이터와 기존 volume은 삭제하지 않는다.

## 이미지 소유자와 배포 정보

기본 이미지 주소는 `ghcr.io/sidetool`이며 `.env`의 `MOA_IMAGE_OWNER`로 변경할 수 있다. Git에서 빌드할 때는 커밋을 이미지에 기록한다.

```sh
MOA_REVISION=$(git rev-parse HEAD) docker compose build
docker compose up -d --pull never
```

실행 중인 Docker 이미지에 커밋 정보가 없으면 위 명령으로 처음 한 번 빌드한다. 실행 중인 이미지가 선택한 소스보다 앞서거나 다른 기록에 속하면 자동 업데이트를 중단한다. 호스트에서 배포할 브랜치를 확인하고 해당 이미지의 커밋을 포함한 소스를 사용한다.

GitHub Actions는 실행한 저장소 소유자의 GHCR에 이미지를 발행한다. `main`은 `edge`와 커밋 태그를, 완성된 정식 릴리스는 `stable`/`latest`와 버전 태그를 사용하며, 포크의 작업 브랜치는 해당 브랜치에서 직접 빌드해 테스트한다. 업데이트 도구도 소스 설치에서는 현재 추적 브랜치를 그대로 유지한다.

## 정식·베타 릴리스 설치

새 `release` 모드는 서명된 GitHub Release와 이미지 digest를 사용합니다. 기존 `auto|git|docker` 설치를 자동 전환하지 않습니다. `source`는 기존 소스 설치의 명시적 이름이며 Git/빌드 방식은 그대로 유지됩니다. **정기 확인·예약 적용은 release 모드에서만 제공**합니다. 기존 Docker 모드의 가변 태그 확인은 여전히 이미지를 pull합니다.

### 최초 설치

Linux, Node 22 이상, Docker Compose 2.24 이상이 필요합니다. 앱은 amd64/arm64를 지원하고 브라우저 인증 컨테이너는 현재 amd64 전용입니다. Docker를 실행할 수 있는 사용자로 진행합니다. 시스템 Node·Docker를 자동 설치하거나 갱신하지 않습니다.

1. 원하는 정식 또는 베타의 `moa-install.tar.gz`, `moa-install.tar.gz.sig`, `release.json`, `release.json.sig`, `moa-release.json`을 받습니다. 최초 부트스트랩 파일과 신뢰 공개키는 maintainer가 게시한 별도 검증 가능한 배포 경로/키 지문으로 확인합니다. 같은 다운로드에 포함된 키만으로 게시자의 신원을 검증했다고 간주하지 마세요. 이후 업데이트는 설치할 때 고정한 Ed25519 키로 검증합니다.
2. 신뢰한 공개키로 설치 파일의 서명을 먼저 검증하고 압축을 풉니다. OpenSSL 3에서는 다음 명령을 쓸 수 있습니다.

   ```sh
   openssl pkeyutl -verify -pubin -inkey /absolute/path/trusted-key.pem \
     -rawin -in moa-install.tar.gz -sigfile moa-install.tar.gz.sig
   tar -xzf moa-install.tar.gz
   ```

   검증 실패 시 설치하지 않습니다. `trusted-key.pem`이 신뢰하는 키와 같은지 확인한 후 아래를 실행합니다. 예시 버전 번호는 실제 공개 버전으로 바꿉니다. 브라우저 기능이 필요할 때만 `--browser true`를 추가합니다.

   ```sh
   node moa-install/scripts/install-release.mjs install \
     --cwd /absolute/path/moa --project moa \
     --version v1.0.0-beta.1 --key /absolute/path/trusted-key.pem
   ```

3. `/absolute/path/moa/moa-updater.service`를 확인하고 한 번 등록합니다.

   ```sh
   mkdir -p ~/.config/systemd/user
   cp /absolute/path/moa/moa-updater.service ~/.config/systemd/user/moa-updater.service
   systemctl --user daemon-reload
   systemctl --user enable --now moa-updater.service
   ```

로그아웃 후에도 호스트 도구가 필요하면 해당 사용자의 systemd lingering을 호스트 관리자가 설정해야 합니다. Docker rootless 또는 user namespace remapping 사용 시 공유 updater 디렉터리의 그룹 접근이 별도 조정될 수 있습니다. 앱에는 Docker socket을 마운트하지 않습니다.

설치 파일과 관리 상태는 `.moa-release/`, 앱과 도구 간 상태 전달은 `data/updater/`에 보관합니다. 사용자 `.env`는 덮어쓰지 않습니다. 포트/볼륨/장치/환경은 설치 시 해석한 Compose 설정에 고정되므로, 이후 `.env`를 바꾸는 것만으로 실행 설정이 바뀌지는 않습니다. 배포 설정 변경은 관리자 작업입니다. 릴리스 적용은 이 설정을 보존하고 선택된 서비스 이미지만 바꿉니다.

### 기존 설치 이관

먼저 **미리보기만** 실행합니다.

```sh
node moa-install/scripts/install-release.mjs preview \
  --cwd /absolute/path/existing-moa --version v1.0.0-beta.1 \
  --key /absolute/path/trusted-key.pem
```

미리보기는 현재 실행 중인 서비스 이미지와 선택한 릴리스의 digest가 정확히 일치하는지 확인합니다. 사용자 빌드·개발 브랜치·다른 이미지가 섞였으면 이관을 막습니다. 현재 설치에만 있는 기능을 잃을 수 있으므로 로컬 이미지를 공개 릴리스로 자동 덮어쓰지 않습니다.

대상 릴리스로 별도 수동 이관을 완료하고 `ready: true`인 경우에만 `preview`를 `adopt`로 바꿔 등록합니다. 기존 호스트 업데이터를 먼저 멈추고 새 서비스 파일로 교체합니다. Git checkout, 사용자 override, 데이터 볼륨은 삭제하지 않습니다. `adopt`는 관리 이미지는 그대로 둔 채 버전 관리 상태와 앱의 updater 연결을 설정합니다. 데이터 경로가 `/data`와 다른 사용자 배포나 같은 볼륨에 외부 쓰기 서비스가 있는 구성은 별도 이관 검토가 필요합니다.

### 확인·예약 적용

설정 → 업데이트에서 채널 **정식/베타**, 자동 확인, 자동 업데이트, 시간대와 시간 구간을 선택합니다.

- 기본값은 정식, 6시간마다 확인(±10% 분산), 자동 적용 꺼짐입니다.
- 베타는 베타와 정식 중 가장 높은 지원 버전을 선택합니다. 정식으로 바꿔도 현재보다 낮은 버전으로 내려가지 않습니다.
- 확인은 릴리스 metadata만 받습니다. 이미지 다운로드는 적용 단계에서만 합니다. 실패한 확인은 1시간 뒤 다시 시도합니다.
- 재생·번역·스캔 중이거나 앱 heartbeat가 없으면 자동 적용을 미룹니다. 적용 직전 유지보수 lease를 확인하고 새 API 작업을 잠시 막습니다.
- 필요한 이미지를 먼저 받은 뒤 쓰기 서비스를 멈추고 `/data` 전체를 로컬 백업합니다. 앱과 인증 DB의 WAL도 정지 상태에서 함께 복사합니다. 백업에는 비밀이 포함될 수 있으며 owner-only 관리 경로 밖으로 업로드하지 않습니다.
- 백업 성공 뒤 digest 고정 이미지로 재생성하고 컨테이너 health와 앱 health를 확인합니다. 같은 스키마 epoch이며 구버전 실행이 가능하다고 maintainer가 선언한 릴리스만 인앱 적용합니다.
- 실패하면 기존 이미지 조합을 다시 실행합니다. **새 사용자 데이터를 과거 DB로 자동 덮어쓰지 않습니다.** 스키마 변경·비가역 migration은 인앱 업데이트가 차단되며 릴리스의 수동 이관 절차를 따라야 합니다.
- 실패한 버전은 자동 재시도하지 않습니다. 최근 20건의 결과와 최근 2개 백업을 보관합니다. 백업 정리는 성공한 적용 뒤에만 합니다. 이미지 캐시·예전 도구 파일은 임의 삭제하지 않습니다.

적용 중 도구가 종료되면 journal을 읽고 기존 호환 이미지 조합 복구를 먼저 시도합니다. `수동 복구 필요`에서는 추가 자동 적용을 막습니다. 호스트에서 `.moa-release/journal.json`의 `previous.compose`를 확인하고 다음 형태로 이전 조합을 실행할 수 있습니다.

```sh
docker compose --project-name YOUR_PROJECT --project-directory /absolute/path/moa \
  -f /absolute/path/to/previous/compose.json up -d --no-build --pull never --wait
```

백업을 복원할 경우 먼저 모든 쓰기 서비스를 정지하고, 업데이트 후 새 데이터가 있는지 확인하세요. 자동 복구는 백업 DB를 복원하지 않습니다. journal/관리 파일에는 로컬 경로·환경 정보가 있으므로 공개 이슈에 원문을 첨부하지 마세요. 상태가 정상인지 확인한 후 관리자가 journal을 별도 보관·정리하고 도구를 재시작합니다.

### 호스트 도구 갱신

최초 서비스는 고정 런처를 실행하고, 실제 업데이터는 릴리스별 디렉터리에 저장됩니다. 앱 업데이트 전에 서명으로 검증한 새 도구의 protocol probe를 실행합니다. 성공 후 current 포인터를 바꾸며, 새 도구가 시작 즉시 실패하면 이전 도구 경로로 되돌립니다. 실행 중인 파일을 덮어쓰지 않습니다. 프로토콜이 맞지 않거나 현재 도구보다 높은 minimumUpdaterVersion을 요구하면 수동 도구 갱신을 안내합니다. 신뢰키 교체 및 고정 런처 자체의 갱신 역시 현재는 관리자 작업입니다.

## Maintainer: 릴리스 발행

`main` 빌드는 `edge`/`sha-*`만 갱신합니다. 버전 태그는 별도 `Release` workflow를 실행합니다. 공개 발행 전 GitHub `releases` environment를 만들고 검토자를 지정한 뒤 Ed25519 개인키를 `RELEASE_PRIVATE_KEY` secret, 대응 PEM 공개키를 `RELEASE_PUBLIC_KEY` variable에 등록합니다. 키는 저장소에 커밋하지 않습니다. 공개키와 지문은 사용자가 독립적으로 확인할 수 있는 경로에 게시해야 합니다.

`deploy/release-policy.json`은 **매 릴리스마다 해당 version, minimumVersion, schemaEpoch, rollbackSafe를 직접 검토**해야 합니다. 기본 `version: null`, `rollbackSafe: false`는 검토 없이 발행/무인 적용되는 것을 막기 위한 값입니다. 기존 DB에 실제로 구버전 앱을 실행할 수 있는 경우에만 `rollbackSafe: true`로 선언합니다.

태그는 `vX.Y.Z` 또는 `vX.Y.Z-beta.N`입니다. typecheck·필수 테스트 후 5개 구성요소 이미지를 빌드하고 digest를 모읍니다. 설치 파일은 고정된 공개 파일 목록으로 생성하며, 소스 저장소 전체를 아카이브하지 않습니다. Ed25519 서명 manifest와 모든 파일이 준비된 draft만 공개합니다. 이미 공개한 버전은 다시 발행할 수 없습니다. 정식은 stable/latest, 베타는 beta 별칭을 갱신하지만 오래된 backport가 최신 별칭을 뒤로 돌리지 않도록 버전을 비교합니다. 인앱 업데이트는 별칭 대신 manifest의 digest만 사용합니다.

릴리스 파일 계약은 `scripts/release.mjs`, 설치 묶음 allowlist는 `scripts/release-bundle.mjs`에 있습니다. `moa-release.json`은 경로 제한된 UTF-8 파일 묶음으로, updater가 임의 아카이브 경로를 추출하지 않게 합니다. tar 설치 파일은 별도 바이너리 Ed25519 서명도 제공합니다. 체크섬은 전송 오류 확인용이며 서명을 대신하지 않습니다.

아직 공개 릴리스·서명키·registry 산출물을 실제로 발행하지 않았다면 개인 서비스에 release 모드를 강제로 적용하지 마세요. 최초 베타 공개 전 격리된 Docker 환경의 설치/업데이트/복구 확인과 공개 registry의 지원 플랫폼 빌드 확인이 필요합니다.
