import org.moa.apk.UrlHeaders;
import org.moa.apk.UrlHeaderCalls;
import okhttp3.Headers;
import org.objectweb.asm.*;
public final class UrlHeadersSmoke {
 public static void main(String[] args)throws Exception {
  var builder=new Headers.Builder();
  UrlHeaders.set(builder,"Referer","https://example.org/daily/토?제목=애니");
  if(!builder.get("Referer").equals("https://example.org/daily/%ED%86%A0?%EC%A0%9C%EB%AA%A9=%EC%95%A0%EB%8B%88"))throw new AssertionError("URL encoding");
  for(String name:new String[]{"Referer","Origin","Authorization"}) {
    try {UrlHeaders.set(new Headers.Builder(),name,"https://example.org/토\r\nX: bad");throw new AssertionError("controls accepted");}catch(IllegalArgumentException expected){}
  }
  try {UrlHeaders.add(new Headers.Builder(),"Authorization","토큰");throw new AssertionError("non URL header altered");}catch(IllegalArgumentException expected){}
  if(!UrlHeaders.normalize("Referer","https://example.org/%ED%86%A0").equals("https://example.org/%ED%86%A0"))throw new AssertionError("double encoded");
  // Verify converted call sites route to the compatibility helper and still execute with the original stack shape.
  ClassWriter cw=new ClassWriter(0);cw.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC,"HeaderFixture",null,"java/lang/Object",null);
  MethodVisitor m=cw.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC,"header","()Ljava/lang/String;",null,null);m.visitCode();
  m.visitTypeInsn(Opcodes.NEW,"okhttp3/Headers$Builder");m.visitInsn(Opcodes.DUP);m.visitMethodInsn(Opcodes.INVOKESPECIAL,"okhttp3/Headers$Builder","<init>","()V",false);
  m.visitLdcInsn("Referer");m.visitLdcInsn("https://example.org/토");m.visitMethodInsn(Opcodes.INVOKEVIRTUAL,"okhttp3/Headers$Builder","set","(Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Headers$Builder;",false);
  m.visitLdcInsn("Referer");m.visitMethodInsn(Opcodes.INVOKEVIRTUAL,"okhttp3/Headers$Builder","get","(Ljava/lang/String;)Ljava/lang/String;",false);m.visitInsn(Opcodes.ARETURN);m.visitMaxs(3,0);m.visitEnd();cw.visitEnd();
  byte[] bytes=UrlHeaderCalls.rewrite(cw.toByteArray());
  Class<?> cls=new ClassLoader(){Class<?> make(){return defineClass("HeaderFixture",bytes,0,bytes.length);}}.make();
  if(!cls.getMethod("header").invoke(null).equals("https://example.org/%ED%86%A0"))throw new AssertionError("converted bytecode");
  // A real dex2jar fallback error must be repaired without disabling JVM verification.
  cw=new ClassWriter(0);cw.visit(Opcodes.V1_8,Opcodes.ACC_PUBLIC,"FrameFixture",null,"java/lang/Object",null);
  m=cw.visitMethod(Opcodes.ACC_PUBLIC|Opcodes.ACC_STATIC,"pick","(Z)Ljava/lang/Object;",null,null);m.visitCode();
  var other=new Label();var end=new Label();m.visitVarInsn(Opcodes.ILOAD,0);m.visitJumpInsn(Opcodes.IFEQ,other);
  m.visitLdcInsn("yes");m.visitJumpInsn(Opcodes.GOTO,end);m.visitLabel(other);m.visitFrame(Opcodes.F_SAME,0,null,0,null);
  m.visitInsn(Opcodes.ICONST_1);m.visitMethodInsn(Opcodes.INVOKESTATIC,"java/lang/Integer","valueOf","(I)Ljava/lang/Integer;",false);
  m.visitLabel(end);m.visitFrame(Opcodes.F_SAME1,0,null,1,new Object[]{"java/util/Object"});
  m.visitInsn(Opcodes.ARETURN);m.visitMaxs(1,1);m.visitEnd();cw.visitEnd();
  byte[] repaired=UrlHeaderCalls.rewrite(cw.toByteArray());
  Class<?> frame=new ClassLoader(){Class<?> make(){return defineClass("FrameFixture",repaired,0,repaired.length);}}.make();
  if(!frame.getMethod("pick",boolean.class).invoke(null,true).equals("yes") || !frame.getMethod("pick",boolean.class).invoke(null,false).equals(1))throw new AssertionError("stack-map repair");
  System.out.println("URL header and stack-map smoke passed");
 }
}
