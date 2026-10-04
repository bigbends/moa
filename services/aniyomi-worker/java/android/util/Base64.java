package android.util;
import java.nio.charset.StandardCharsets;
public final class Base64 {
 public static final int DEFAULT=0,NO_PADDING=1,NO_WRAP=2,CRLF=4,URL_SAFE=8,NO_CLOSE=16;
 public static byte[] decode(String value,int flags) { return ((flags&URL_SAFE)!=0?java.util.Base64.getUrlDecoder():java.util.Base64.getDecoder()).decode(value.replaceAll("\\s", "")); }
 public static byte[] decode(byte[] value,int flags) { return decode(new String(value,StandardCharsets.US_ASCII),flags); }
 public static String encodeToString(byte[] value,int flags) {
  var encoder=(flags&URL_SAFE)!=0?java.util.Base64.getUrlEncoder():java.util.Base64.getEncoder();if((flags&NO_PADDING)!=0)encoder=encoder.withoutPadding();
  String out=encoder.encodeToString(value);if((flags&NO_WRAP)!=0||out.isEmpty())return out;
  String sep=(flags&CRLF)!=0?"\r\n":"\n";return out.replaceAll("(.{76})","$1"+sep)+(out.length()%76==0?"":sep);
 }
 public static byte[] encode(byte[] value,int flags) { return encodeToString(value,flags).getBytes(StandardCharsets.US_ASCII); }
}
