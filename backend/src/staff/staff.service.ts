import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EstateAccessService } from '../estate-access/estate-access.service';
import { StorageService } from '../files/storage.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import type { CreateStaffMemberDto } from './dto/create-staff-member.dto';
import type { UpdateStaffMemberDto } from './dto/update-staff-member.dto';
import { dateOrNull } from '../common/date-or-null';

/** Fichero multipart tal y como lo entrega multer (sin @types/multer). */
interface UploadedMulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estateAccess: EstateAccessService,
    private readonly storage: StorageService,
  ) {}

  async listStaff(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    return this.prisma.staffMember.findMany({
      where: { estateId },
      orderBy: { fullName: 'asc' },
    });
  }

  /**
   * Vista de solo lectura para el propietario (rol C): solo personal activo,
   * y solo lo necesario para contactarlo — nunca DNI, coste mensual, tipo o
   * fechas de contrato (datos de RRHH que no le incumben).
   */
  async listDirectory(estateId: string, user: AuthenticatedUser) {
    this.estateAccess.assertAccess(estateId, user);
    const staff = await this.prisma.staffMember.findMany({
      where: { estateId, status: 'Activo' },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        position: true,
        phone: true,
        email: true,
        schedule: true,
      },
    });
    return staff;
  }

  async createStaffMember(
    estateId: string,
    dto: CreateStaffMemberDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    if (!user.administratorId) {
      throw new ForbiddenException('Usuario sin gestora asociada.');
    }
    return this.prisma.staffMember.create({
      data: {
        estateId,
        administratorId: user.administratorId,
        fullName: dto.fullName,
        position: dto.position,
        nationalId: dto.nationalId,
        email: dto.email,
        phone: dto.phone,
        contractType: dto.contractType,
        startDate: new Date(dto.startDate),
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        schedule: dto.schedule,
        monthlyCost: dto.monthlyCost,
      },
    });
  }

  private async assertStaffInEstate(
    estateId: string,
    staffId: string,
  ): Promise<void> {
    const staff = await this.prisma.staffMember.findUnique({
      where: { id: staffId },
      select: { estateId: true },
    });
    if (!staff || staff.estateId !== estateId) {
      throw new NotFoundException(
        'Miembro del personal no encontrado en esta finca.',
      );
    }
  }

  async updateStaffMember(
    estateId: string,
    staffId: string,
    dto: UpdateStaffMemberDto,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertStaffInEstate(estateId, staffId);
    return this.prisma.staffMember.update({
      where: { id: staffId },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.nationalId !== undefined && { nationalId: dto.nationalId }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.contractType !== undefined && {
          contractType: dto.contractType,
        }),
        ...(dto.startDate !== undefined && {
          startDate: new Date(dto.startDate),
        }),
        ...(dto.endDate !== undefined && { endDate: dateOrNull(dto.endDate) }),
        ...(dto.schedule !== undefined && { schedule: dto.schedule }),
        ...(dto.monthlyCost !== undefined && { monthlyCost: dto.monthlyCost }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async listDocuments(
    estateId: string,
    staffId: string,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertStaffInEstate(estateId, staffId);
    return this.prisma.staffDocument.findMany({
      where: { staffMemberId: staffId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async uploadDocument(
    estateId: string,
    staffId: string,
    title: string,
    file: UploadedMulterFile,
    user: AuthenticatedUser,
  ) {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertStaffInEstate(estateId, staffId);
    if (!file) {
      throw new NotFoundException(
        'No se recibió ningún fichero (campo "file").',
      );
    }
    this.storage.assertAllowed(file.mimetype, file.size);
    const s3Key = await this.storage.put(
      `staff-documents/${staffId}`,
      file.originalname,
      file.buffer,
    );
    return this.prisma.staffDocument.create({
      data: {
        staffMemberId: staffId,
        title: title?.trim() || file.originalname,
        fileName: file.originalname,
        mimeType: file.mimetype,
        s3Key,
      },
    });
  }

  private async assertDocumentInStaff(
    staffId: string,
    docId: string,
  ): Promise<{ s3Key: string; fileName: string; mimeType: string }> {
    const doc = await this.prisma.staffDocument.findUnique({
      where: { id: docId },
      select: {
        staffMemberId: true,
        s3Key: true,
        fileName: true,
        mimeType: true,
      },
    });
    if (!doc || doc.staffMemberId !== staffId) {
      throw new NotFoundException(
        'Documento no encontrado para este miembro del personal.',
      );
    }
    return doc;
  }

  async getDocumentFileContent(
    estateId: string,
    staffId: string,
    docId: string,
    user: AuthenticatedUser,
  ): Promise<{ content: Buffer; fileName: string; mimeType: string }> {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertStaffInEstate(estateId, staffId);
    const doc = await this.assertDocumentInStaff(staffId, docId);
    const content = await this.storage.get(doc.s3Key);
    return { content, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  async deleteDocument(
    estateId: string,
    staffId: string,
    docId: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.estateAccess.assertAccess(estateId, user);
    await this.assertStaffInEstate(estateId, staffId);
    const doc = await this.assertDocumentInStaff(staffId, docId);
    await this.prisma.staffDocument.delete({ where: { id: docId } });
    await this.storage.delete(doc.s3Key);
  }
}
