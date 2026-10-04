# Docker 셀프호스팅

Docker Engine과 Compose가 필요하다. 다음 명령은 **새 설치**용이다. 기존 설치는 데이터·비밀 파일과 미디어의 컨테이너 경로를 먼저 보존한다.

```sh
cp .env.example .env
mkdir -p data/auth/config data/auth/sessions deploy/local
python3 deploy/auth/set-password.py
```

`.env`의 `MEDIA_PATH`를 자신이 접근할 수 있는 미디어 디렉터리로 바꾼다. 앱의 미디어 경로는 기본 `/media/library`다. `data`와 `data/auth/sessions`는 컨테이너의 Node 사용자(UID 1000)가 쓰고, `data/auth/config/credentials.json`은 읽을 수 있어야 한다. 생성 스크립트는 비밀번호를 화면에 표시하지 않는다. 실제 키·DB·비밀 파일은 Git과 이미지 build context에서 제외한다.

```sh
sudo chown -R 1000:1000 data
sudo chmod 700 data/auth/config data/auth/sessions
sudo chmod 600 data/auth/config/credentials.json
docker compose config --quiet
docker compose build
docker compose up -d
```

기본 주소는 `http://localhost:8796`이다. 앱 포트 8795는 계정 헤더를 신뢰하므로 외부에 노출하지 않는다. 설정에서 `/media/library`의 폴더를 등록한 뒤 스캔한다. 새 DB에는 확장 저장소가 없다. [직접 신뢰하는 저장소만 추가](EXTENSIONS.md)한다.

## 도메인과 HTTPS

HTTPS reverse proxy를 gateway 앞에 둔다. `.env`의 `PUBLIC_HOST`는 호스트 이름(포트 제외), `PUBLIC_ORIGIN`은 브라우저에서 쓰는 전체 origin, `PUBLIC_SCHEME`은 `https`로 맞춘다. 예: `media.example.com`, `https://media.example.com`, `https`. 프록시는 같은 Host 헤더를 전달해야 한다. 별도 포트라면 origin과 Host 헤더에 그 포트가 포함되어야 한다. nginx의 입력 템플릿은 읽기 전용이며 공식 entrypoint가 `/etc/nginx/conf.d`에 렌더링한다. nginx 런타임 변수는 envsubst 필터로 보존한다.

기본 gateway는 연결 상대의 IP를 사용한다. 신뢰하는 edge 뒤에서만 `GATEWAY_CLIENT_IP`를 해당 edge의 클라이언트 IP 변수로 바꾼다. 예를 들어 Cloudflare 전용 경로는 `GATEWAY_CLIENT_IP='$http_cf_connecting_ip'`다. origin·scheme을 바꾸면 인증 쿠키의 Secure 속성도 함께 바뀐다. 원격 접속에는 HTTPS를 사용한다.

## 선택 구성

Linux에서 `.env`의 `COMPOSE_FILE`에 콜론으로 override를 추가한다. 다른 플랫폼은 Compose의 파일 구분자 또는 명시적인 `-f` 인자를 사용한다.

| 구성 | override | 준비 |
| --- | --- | --- |
| APK worker | `compose.aniyomi.yaml` | worker와 앱이 공유할 token 파일 |
| Linux VAAPI | `compose.vaapi.yaml` | render 장치의 GID와 GPU 드라이버 |
| Cloudflare tunnel | `compose.tunnel.yaml` | 배포자 소유 tunnel config와 credentials |

APK worker 예:

```sh
mkdir -p data/apk-config
python3 - <<'PYTOKEN'
from pathlib import Path
import os, secrets
p = Path('data/apk-config/token')
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    out.write(secrets.token_hex(32) + '\n')
PYTOKEN
sudo chown 10001:10001 data/apk-config/token
```

`COMPOSE_FILE=compose.yaml:compose.aniyomi.yaml`로 설정한다. 앱 UID 1000과 worker UID 10001이 모두 token을 읽어야 한다. 공유 그룹 또는 ACL로 앱 UID에도 읽기 권한을 준다. 예: `sudo setfacl -m u:1000:r data/apk-config/token`. 다른 파일을 쓰려면 `MOA_APK_TOKEN_FILE`을 바꾼다. worker는 호스트 포트 없이 내부 RPC만 연다. 기존 설치는 token·named volume을 새로 만들지 않는다.

VAAPI는 `COMPOSE_FILE`에 `:compose.vaapi.yaml`을 추가하고 `stat -c %g /dev/dri/renderD128`로 확인한 GID를 `MOA_RENDER_GID`에 넣는다. `MOA_VAAPI_DEVICE`, `MOA_DRI_PATH`, 필요하면 `LIBVA_DRIVER_NAME`을 설정한다. GPU가 없으면 기본 구성의 소프트웨어 처리를 사용한다.

터널은 `deploy/cloudflared/config.example.yml`을 `deploy/local/cloudflared/config.yml`로 복사한 뒤 자신의 tunnel ID와 hostname을 넣는다. Cloudflare가 발급한 credentials JSON은 `deploy/local/cloudflared/tunnel.json`에 둔다. JSON을 직접 작성하거나 공개하지 않는다. `TUNNEL_UID/GID`에 읽기 권한을 주고 `COMPOSE_FILE`에 `:compose.tunnel.yaml`을 추가한다. 기존 private 경로를 유지하려면 `CF_TUNNEL_CONFIG_FILE`, `CF_TUNNEL_CREDENTIALS_FILE`로 지정한다. 터널은 필수 구성요소가 아니다.

## 키, 프록시, 백업과 업그레이드

TMDB는 자신이 발급받은 `MOA_TMDB_TOKEN` 또는 `MOA_TMDB_API_KEY`를 `.env`에 넣는다. 승인된 귀속 표시·API 이용 조건은 [TMDB FAQ](https://developer.themoviedb.org/docs/faq)를 따른다. README 문구만으로 앱 귀속 표시를 충족한다고 간주하지 않는다.

기본 outbound proxy는 앱의 설정 → 소스 연결에서 관리한다. 빈 값은 직접 연결이고 HTTP(S) CONNECT와 SOCKS5를 지원한다. 기존 proxy 설정은 앱 SQLite에 저장되므로 데이터 디렉터리를 보존한다. Gemini 키도 관리자 화면에서 관리하며 관련 비밀 파일은 `/data`에 저장한다. 번역은 자막과 문맥을 외부 API로 보내고 비용이 발생할 수 있다.

업그레이드 전 앱·인증 DB, `.env`, `deploy/local`, APK named volume과 token을 비공개로 백업한다. SQLite 파일은 일관된 backup API를 쓰거나 서비스를 멈춘 상태에서 복사하고 WAL/SHM도 고려한다. 미디어는 별도로 보존한다. 기존 설치의 `MEDIA_CONTAINER_PATH`를 바꾸면 DB에 저장된 로컬 경로가 달라질 수 있다. 코드 업데이트 후 같은 `COMPOSE_FILE`로 build/up을 실행한다. 백업·운영 측정 결과를 공개 저장소에 추가하지 않는다.
