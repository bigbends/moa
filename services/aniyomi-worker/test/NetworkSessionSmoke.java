import eu.kanade.tachiyomi.network.NetworkHelper;
import okhttp3.Cookie;
import okhttp3.HttpUrl;
import okhttp3.Request;
import java.util.List;
class NetworkSessionSmoke {
 public static void main(String[] args) throws Exception {
  var helper=new NetworkHelper();var jar=helper.getClient().cookieJar();
  var original=HttpUrl.get("https://example.org/watch/a");
  jar.saveFromResponse(original,List.of(new Cookie.Builder().name("session").value("fixture").hostOnlyDomain("example.org").path("/watch").secure().build()));
  if(jar.loadForRequest(original).size()!=1||!jar.loadForRequest(HttpUrl.get("https://cdn.example.org/watch/a")).isEmpty()||!jar.loadForRequest(HttpUrl.get("https://example.org/other")).isEmpty())throw new AssertionError("cookie scope");
  if(!new NetworkHelper().getClient().cookieJar().loadForRequest(original).isEmpty())throw new AssertionError("cookie isolation");
  try { NetworkHelper.validateProxy("https://127.0.0.1:9443");throw new AssertionError("unsupported proxy accepted"); }catch(IllegalArgumentException expected){}
  try { helper.getClient().newCall(new Request.Builder().url("http://127.0.0.1:9/").build()).execute();throw new AssertionError("private destination accepted"); }catch(java.io.IOException expected){if(!expected.getMessage().contains("private_destination"))throw expected;}
  System.out.println("Network: cookie scope/isolation, unsupported proxy and private destination checks passed");
 }
}
