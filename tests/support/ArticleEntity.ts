import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('articles')
export class ArticleEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column('varchar')
  title!: string;

  @Column('text')
  body!: string;
}
