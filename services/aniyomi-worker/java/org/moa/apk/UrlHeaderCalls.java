package org.moa.apk;
import java.nio.file.*;
import java.util.zip.*;
import org.objectweb.asm.*;
/** Conversion-only compatibility pass. Original signed APK bytes are never changed. */
public final class UrlHeaderCalls {
  public static byte[] rewrite(byte[] bytes) {
    ClassReader reader=new ClassReader(bytes);ClassWriter writer=new ClassWriter(0);
    reader.accept(new ClassVisitor(Opcodes.ASM9,writer) {
      public MethodVisitor visitMethod(int access,String name,String descriptor,String signature,String[] exceptions) {
        return new MethodVisitor(Opcodes.ASM9,super.visitMethod(access,name,descriptor,signature,exceptions)) {
          public void visitFrame(int type,int nLocal,Object[] local,int nStack,Object[] stack) {
            // dex2jar 2.4.37 emits this nonexistent common superclass in some merged frames.
            // Correct only verifier metadata, never extension class names or executable instructions.
            super.visitFrame(type,nLocal,frameTypes(local),nStack,frameTypes(stack));
          }
          public void visitMethodInsn(int opcode,String owner,String name,String desc,boolean isInterface) {
            if(opcode==Opcodes.INVOKEVIRTUAL && owner.equals("okhttp3/Headers$Builder") && (name.equals("set")||name.equals("add")) && desc.equals("(Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Headers$Builder;")) {
              super.visitMethodInsn(Opcodes.INVOKESTATIC,"org/moa/apk/UrlHeaders",name,"(Lokhttp3/Headers$Builder;Ljava/lang/String;Ljava/lang/String;)Lokhttp3/Headers$Builder;",false);
            } else super.visitMethodInsn(opcode,owner,name,desc,isInterface);
          }
        };
      }
    },0);return writer.toByteArray();
  }
  private static Object[] frameTypes(Object[] types) {
    if(types==null)return null;
    Object[] fixed=types.clone();
    for(int i=0;i<fixed.length;i++)if("java/util/Object".equals(fixed[i]))fixed[i]="java/lang/Object";
    return fixed;
  }
  public static void main(String[] args)throws Exception {
    Path target=Path.of(args[0]),temp=Path.of(args[0]+".headers");
    try(var out=new ZipOutputStream(Files.newOutputStream(temp));var jar=new ZipFile(target.toFile())) {
      var entries=jar.entries();long total=0;
      while(entries.hasMoreElements()) {
        var entry=entries.nextElement();var next=new ZipEntry(entry.getName());next.setTime(0);out.putNextEntry(next);
        try(var in=jar.getInputStream(entry)) {
          byte[] bytes=in.readNBytes(16*1024*1024+1);
          if(bytes.length>16*1024*1024 || (total+=bytes.length)>64*1024*1024)throw new IllegalArgumentException("apk_expansion_limit");
          out.write(entry.getName().endsWith(".class")?rewrite(bytes):bytes);
        }
        out.closeEntry();
      }
    }catch(Throwable error){Files.deleteIfExists(temp);throw error;}
    Files.move(temp,target,StandardCopyOption.REPLACE_EXISTING);
  }
}
