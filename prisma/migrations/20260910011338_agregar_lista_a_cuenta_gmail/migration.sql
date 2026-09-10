-- AlterTable
ALTER TABLE "cuentas_gmail" ADD COLUMN     "listaId" TEXT;

-- AddForeignKey
ALTER TABLE "cuentas_gmail" ADD CONSTRAINT "cuentas_gmail_listaId_fkey" FOREIGN KEY ("listaId") REFERENCES "listas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
