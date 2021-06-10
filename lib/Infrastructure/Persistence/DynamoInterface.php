<?php
declare(strict_types=1);

namespace App\Infrastructure\Persistence;

interface DynamoInterface  {
	public static function tableName(): string;

	public static function hashName(): string;

	public static function rangeName(): ?string;

	public static function hydrate(array $item): self;

	public function output() :array;
}
