package android.util;
/** Android diagnostic logging is not sent to the RPC stream or retained with source credentials. */
public final class Log {
 public static int d(String tag,String msg){return 0;}public static int i(String tag,String msg){return 0;}
 public static int w(String tag,String msg){return 0;}public static int e(String tag,String msg){return 0;}
 public static int w(String tag,String msg,Throwable t){return 0;}
 public static int v(String tag,String msg){return 0;}public static int e(String tag,String msg,Throwable t){return 0;}
}
