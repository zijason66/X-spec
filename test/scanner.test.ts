import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  scanProject,
  renderArchitectureMd,
  renderTechStackMd,
  renderApiMd,
  renderSchemaMd,
  renderClassIndexMd,
  renderSdkMd,
} from '../src/core/project-scanner';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'x-spec-scan-'));
}

function writeFile(dir: string, relPath: string, content: string): void {
  const fullPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf-8');
}

describe('project-scanner', () => {
  let tempDir: string;

  beforeEach(() => { tempDir = createTempDir(); });
  afterEach(() => { fs.rmSync(tempDir, { recursive: true, force: true }); });

  describe('Java/Maven 项目', () => {
    beforeEach(() => {
      writeFile(tempDir, 'pom.xml', `<?xml version="1.0"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.demo</groupId>
  <artifactId>DemoService</artifactId>
  <version>1.0.0</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.0</version>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-redis</artifactId>
      <version>3.2.0</version>
    </dependency>
    <dependency>
      <groupId>mysql</groupId>
      <artifactId>mysql-connector-java</artifactId>
      <version>8.0.33</version>
    </dependency>
    <dependency>
      <groupId>org.projectlombok</groupId>
      <artifactId>lombok</artifactId>
      <version>1.18.30</version>
      <scope>provided</scope>
    </dependency>
    <dependency>
      <groupId>junit</groupId>
      <artifactId>junit</artifactId>
      <version>4.13.2</version>
      <scope>test</scope>
    </dependency>
  </dependencies>
</project>`);

      writeFile(tempDir, 'src/main/java/com/demo/DemoServiceApplication.java', `package com.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(DemoServiceApplication.class, args);
    }
}`);

      writeFile(tempDir, 'src/main/java/com/demo/controller/UserController.java', `package com.demo.controller;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
public class UserController {
    @GetMapping("/users")
    public String listUsers() { return "[]"; }
}`);

      writeFile(tempDir, 'src/main/java/com/demo/service/UserService.java', `package com.demo.service;

import org.springframework.stereotype.Service;

@Service
public class UserService {
    public String findUser() { return "user"; }
}`);

      writeFile(tempDir, 'src/main/java/com/demo/repository/UserRepository.java', `package com.demo.repository;

import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {
}`);

      writeFile(tempDir, 'src/main/java/com/demo/entity/User.java', `package com.demo.entity;

import javax.persistence.Entity;
import javax.persistence.Table;
import javax.persistence.Id;
import javax.persistence.Column;

@Entity
@Table(name = "t_user")
public class User {
    @Id
    @Column(name = "id")
    private Long id;

    @Column(name = "username")
    private String username;

    @Column(name = "email")
    private String email;
}`);

      writeFile(tempDir, 'src/main/java/com/demo/client/OrderClient.java', `package com.demo.client;

import org.springframework.cloud.openfeign.FeignClient;

@FeignClient(name = "order-service", url = "https://order.example.com")
public interface OrderClient {
}`);
    });

    it('识别为 java-maven 项目', () => {
      const result = scanProject(tempDir);
      expect(result.projectType.kind).toBe('java-maven');
      expect(result.projectType.language).toBe('Java');
      expect(result.projectType.buildTool).toBe('Maven');
    });

    it('解析 Maven 依赖', () => {
      const result = scanProject(tempDir);
      const names = result.techStack.dependencies.map(d => d.name);
      expect(names).toContain('spring-boot-starter-web');
      expect(names).toContain('mysql-connector-java');
      expect(names).toContain('lombok');
    });

    it('识别分层目录', () => {
      const result = scanProject(tempDir);
      const layerNames = result.architecture.layers.map(l => l.name);
      expect(layerNames).toContain('controller');
      expect(layerNames).toContain('service');
      expect(layerNames).toContain('repository');
      expect(layerNames).toContain('entity');
    });

    it('识别 Spring Boot 入口点', () => {
      const result = scanProject(tempDir);
      expect(result.architecture.entryPoints.length).toBeGreaterThan(0);
      const entry = result.architecture.entryPoints.find(e => e.symbol === 'DemoServiceApplication');
      expect(entry).toBeDefined();
      expect(entry?.kind).toBe('spring-boot-main');
    });

    it('提取带注解的关键类', () => {
      const result = scanProject(tempDir);
      const userController = result.keyClasses.find(c => c.className === 'UserController');
      expect(userController).toBeDefined();
      expect(userController?.stereotype).toBe('RestController');
      expect(userController?.language).toBe('java');

      const userService = result.keyClasses.find(c => c.className === 'UserService');
      expect(userService?.stereotype).toBe('Service');
    });

    it('从 JPA Entity 提取数据表', () => {
      const result = scanProject(tempDir);
      const userTable = result.dataTables.find(t => t.name === 't_user');
      expect(userTable).toBeDefined();
      expect(userTable?.source).toBe('jpa-entity');
    });

    it('识别 @FeignClient 外部 API', () => {
      const result = scanProject(tempDir);
      const feignApi = result.externalApis.find(a => a.source === 'feign');
      expect(feignApi).toBeDefined();
      expect(feignApi?.name).toBe('order-service');
    });

    it('SDK 按用途分类', () => {
      const result = scanProject(tempDir);
      const middleware = result.sdks.filter(s => s.purpose === 'middleware');
      expect(middleware.some(s => s.name.includes('mysql-connector-java'))).toBe(true);
      expect(middleware.some(s => s.name.includes('redis'))).toBe(true);

      const testDeps = result.sdks.filter(s => s.purpose === 'test');
      expect(testDeps.some(s => s.name.includes('junit'))).toBe(true);
    });

    it('渲染 architecture.md 包含关键信息', () => {
      const result = scanProject(tempDir);
      const md = renderArchitectureMd(result);
      expect(md).toContain('java-maven');
      expect(md).toContain('src/main/java');
      expect(md).toContain('DemoServiceApplication');
      expect(md).toContain('controller');
    });

    it('渲染 class-index.md 包含关键类', () => {
      const result = scanProject(tempDir);
      const md = renderClassIndexMd(result);
      expect(md).toContain('UserController');
      expect(md).toContain('RestController');
    });
  });

  describe('Node/TypeScript 项目', () => {
    beforeEach(() => {
      writeFile(tempDir, 'package.json', JSON.stringify({
        name: 'demo-api',
        version: '1.0.0',
        main: 'dist/index.js',
        scripts: { start: 'node dist/index.js' },
        dependencies: {
          express: '^4.18.0',
          axios: '^1.6.0',
          redis: '^4.6.0',
        },
        devDependencies: {
          vitest: '^1.6.0',
          typescript: '^5.5.0',
        },
      }, null, 2));

      writeFile(tempDir, 'tsconfig.json', '{}');

      writeFile(tempDir, 'src/index.ts', `import express from 'express';
import axios from 'axios';

const app = express();
app.listen(3000);`);

      writeFile(tempDir, 'src/controllers/UserController.ts', `import { Controller, Get } from 'routing-controllers';

@Controller()
export class UserController {
    @Get('/users')
    list() { return []; }
}`);

      writeFile(tempDir, 'src/services/UserService.ts', `import { Injectable } from 'typedi';

@Injectable()
export class UserService {
    findUser() { return 'user'; }
}`);
    });

    it('识别为 node-tsx 项目', () => {
      const result = scanProject(tempDir);
      expect(result.projectType.kind).toBe('node-tsx');
      expect(result.techStack.language).toBe('TypeScript');
    });

    it('解析 package.json 依赖', () => {
      const result = scanProject(tempDir);
      const names = result.techStack.dependencies.map(d => d.name);
      expect(names).toContain('express');
      expect(names).toContain('axios');
      expect(names).toContain('vitest');
    });

    it('识别 Node 入口点', () => {
      const result = scanProject(tempDir);
      const npmScript = result.architecture.entryPoints.find(e => e.kind === 'npm-script');
      expect(npmScript).toBeDefined();
    });

    it('提取 TS 装饰器类', () => {
      const result = scanProject(tempDir);
      const ctrl = result.keyClasses.find(c => c.className === 'UserController');
      expect(ctrl?.stereotype).toBe('Controller');
      expect(ctrl?.language).toBe('typescript');
    });
  });

  describe('SQL 文件扫描', () => {
    beforeEach(() => {
      writeFile(tempDir, 'pom.xml', '<project><modelVersion>4.0.0</modelVersion></project>');
      writeFile(tempDir, 'db/migration/V1__init.sql', `CREATE TABLE t_order (
  id BIGINT NOT NULL,
  order_no VARCHAR(64) NOT NULL,
  user_id BIGINT NOT NULL,
  amount DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'PENDING',
  created_at DATETIME,
  PRIMARY KEY (id)
);

CREATE TABLE t_order_item (
  id BIGINT NOT NULL,
  order_id BIGINT NOT NULL,
  product_name VARCHAR(200),
  quantity INT,
  PRIMARY KEY (id)
);`);
    });

    it('从 SQL 文件提取 CREATE TABLE', () => {
      const result = scanProject(tempDir);
      const tables = result.dataTables.map(t => t.name);
      expect(tables).toContain('t_order');
      expect(tables).toContain('t_order_item');
    });

    it('提取表字段', () => {
      const result = scanProject(tempDir);
      const orderTable = result.dataTables.find(t => t.name === 't_order');
      expect(orderTable?.source).toBe('sql-file');
      const fieldNames = orderTable?.fields.map(f => f.name) || [];
      expect(fieldNames).toContain('id');
      expect(fieldNames).toContain('order_no');
      expect(fieldNames).toContain('user_id');
    });

    it('渲染 schema.md 包含表结构', () => {
      const result = scanProject(tempDir);
      const md = renderSchemaMd(result);
      expect(md).toContain('t_order');
      expect(md).toContain('order_no');
      expect(md).toContain('sql-file');
    });
  });

  describe('空项目/未知类型', () => {
    it('未识别项目类型时返回 unknown', () => {
      const result = scanProject(tempDir);
      expect(result.projectType.kind).toBe('unknown');
      expect(result.techStack.dependencies).toEqual([]);
    });

    it('渲染 tech-stack.md 不崩溃', () => {
      const result = scanProject(tempDir);
      const md = renderTechStackMd(result);
      expect(md).toContain('技术栈');
    });

    it('渲染 api.md 不崩溃', () => {
      const result = scanProject(tempDir);
      const md = renderApiMd(result);
      expect(md).toContain('外部 API');
    });

    it('渲染 sdk.md 不崩溃', () => {
      const result = scanProject(tempDir);
      const md = renderSdkMd(result);
      expect(md).toContain('SDK');
    });
  });

  describe('跳过目录', () => {
    it('跳过 node_modules / target / .git 等', () => {
      writeFile(tempDir, 'pom.xml', '<project><modelVersion>4.0.0</modelVersion></project>');
      writeFile(tempDir, 'node_modules/lib/index.js', 'module.exports = {};');
      writeFile(tempDir, 'target/classes/com/demo/App.class', 'binary');
      writeFile(tempDir, '.git/config', '[core]');

      const result = scanProject(tempDir);
      expect(result.stats.byExtension['.js']).toBeUndefined();
      expect(result.stats.skippedDirs.length).toBeGreaterThan(0);
    });
  });
});
