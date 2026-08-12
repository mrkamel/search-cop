import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type ProductStatus = 'online' | 'offline' | 'pending';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar')
  name!: string;

  @Column('varchar')
  description!: string;

  @Column('varchar')
  status!: ProductStatus;

  @Column('float')
  price!: number;

  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ type: 'datetime' })
  createdAt!: Date;
}
