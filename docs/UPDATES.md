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

기본 이미지 주소는 `ghcr.io/bigbends`이며 `.env`의 `MOA_IMAGE_OWNER`로 변경할 수 있다. Git에서 빌드할 때는 커밋을 이미지에 기록한다.

```sh
MOA_REVISION=$(git rev-parse HEAD) docker compose build
docker compose up -d --pull never
```

실행 중인 Docker 이미지에 커밋 정보가 없으면 위 명령으로 처음 한 번 빌드한다. 실행 중인 이미지가 선택한 소스보다 앞서거나 다른 기록에 속하면 자동 업데이트를 중단한다. 호스트에서 배포할 브랜치를 확인하고 해당 이미지의 커밋을 포함한 소스를 사용한다.

GitHub Actions는 실행한 저장소 소유자의 GHCR에 이미지를 발행한다. `main`의 `latest`, 버전 태그와 커밋 태그를 사용하며, 포크의 작업 브랜치는 해당 브랜치에서 직접 빌드해 테스트한다. 업데이트 도구도 소스 설치에서는 현재 추적 브랜치를 그대로 유지한다.
