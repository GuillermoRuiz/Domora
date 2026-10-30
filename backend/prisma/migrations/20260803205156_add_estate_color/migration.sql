-- DropForeignKey
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_estateId_fkey";

-- AlterTable
ALTER TABLE "estates" ADD COLUMN     "color" VARCHAR(7);

-- CreateIndex
CREATE INDEX "suppliers_estateId_idx" ON "suppliers"("estateId");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_estateId_fkey" FOREIGN KEY ("estateId") REFERENCES "estates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
