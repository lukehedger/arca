import { describe, expect, test } from 'bun:test';
import { isAllowedAwsCommand } from '../permissions/aws-command.ts';

describe('isAllowedAwsCommand', () => {
  test.each([
    'aws sts get-caller-identity',
    'aws --profile readonly sts get-caller-identity',
    'aws --output text --query queryId --color auto logs describe-log-groups',
    'aws --cli-binary-format raw-in-base64-out logs start-query --log-group-names /aws/lambda/pay-create',
    'aws dynamodb query --table-name table',
    'aws lambda get-function --function-name function',
    'aws secretsmanager list-secrets',
    'aws s3api list-objects-v2 --bucket bucket --prefix payments/',
    'aws appconfig get-configuration-profile --application-id app --configuration-profile-id profile',
    'aws appconfigdata get-latest-configuration --configuration-token token outfile',
    'aws cloudwatch list-metrics',
    'aws cloudwatch get-metric-statistics',
    'aws cloudwatch get-metric-data',
    'aws cloudwatch describe-alarms',
    'AWS sts get-caller-identity',
    'Aws sts get-caller-identity',
    '/usr/local/bin/AWS sts get-caller-identity',
  ])('allows an approved read operation: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBe(true);
  });

  test.each([
    'env aws sts get-caller-identity',
    'timeout 10 aws sts get-caller-identity',
    'sudo -u operator aws sts get-caller-identity',
    'command aws sts get-caller-identity',
    'echo account | xargs aws sts get-caller-identity',
    `eval 'aws sts get-caller-identity'`,
    `sh -c 'aws sts get-caller-identity'`,
    `bash -lc 'aws sts get-caller-identity'`,
  ])('allows an approved wrapped invocation: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBe(true);
  });

  test.each([
    'aws dynamodb scan --table-name table',
    'aws lambda invoke --function-name function output.json',
    'aws secretsmanager get-secret-value --secret-id secret',
    'aws s3 put-object --bucket bucket --key key',
    'aws s3 ls',
    'aws cloudformation update-stack --stack-name stack',
    'aws cloudwatch describe-alarm-history',
    'aws sts get-caller-identity; aws s3 put-object --bucket bucket --key key',
    'echo $(aws secretsmanager get-secret-value --secret-id secret)',
    'aws logs start-query --query "$(aws s3 put-object --bucket b --key k)"',
    'env aws s3 rm s3://bucket/key',
    `eval 'aws s3 rm s3://bucket/key'`,
    `bash -lc 'aws s3 rm s3://bucket/key'`,
    'AWS_ACCESS_KEY_ID=value aws sts get-caller-identity',
    'A=aws; $A s3 rm s3://bucket/key',
    `COMMAND='aws s3 rm'; eval "$COMMAND"`,
    '$' + '{COMMAND:-aws} s3 rm s3://bucket/key',
    '$(echo aws) s3 rm s3://bucket/key',
    String.raw`find . -exec aws s3 rm s3://bucket/key {} \;`,
    `perl -e 'exec "aws","s3","rm","s3://bucket/key"'`,
    'AWS s3 rm s3://bucket/key',
    'Aws s3 rm s3://bucket/key',
    'ENV AWS s3 rm s3://bucket/key',
    `BASH -c 'AWS s3 rm s3://bucket/key'`,
    'nohup AWS s3 rm s3://bucket/key',
    'A=AWS; $A s3 rm s3://bucket/key',
  ])(
    'blocks an AWS write, unbounded read or dynamic invocation: %s',
    (command) => {
      expect(isAllowedAwsCommand(command)).toBe(false);
    },
  );

  test.each([
    'bun test',
    'grep -rn "aws-permissions" .',
    `rg '/aws/lambda/' tightrope`,
    `echo 'AWS/Lambda arn:aws:lambda:eu-west-1:123:function:test'`,
    'printf "use aws logs start-query"',
    'grep "aws" file',
    'find . -name aws',
    `echo "AWS isn't the CLI"`,
    'echo "$(printf aws)"',
    'echo "AWS AppConfig"',
    'echo AWS AppConfig',
    'git commit -m "Read the AWS AppConfig profile"',
  ])('ignores a command that does not invoke the CLI: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBeUndefined();
  });
});

describe('isAllowedAwsCommand with ANSI-C and locale quoting', () => {
  test.each([
    String.raw`$'\x61ws' s3 rm s3://bucket/key`,
    `$'aws' s3 rm s3://bucket/key`,
    `$"aws" s3 rm s3://bucket/key`,
    `$'aws' sts get-caller-identity`,
    `/usr/local/bin/$'aws' s3 rm s3://bucket/key`,
    `env $'aws' s3 rm s3://bucket/key`,
    `sudo $'aws' s3 rm s3://bucket/key`,
    `timeout 10 $'aws' s3 rm s3://bucket/key`,
    `eval $'aws' s3 rm s3://bucket/key`,
    `bash -c $'aws s3 rm s3://bucket/key'`,
    String.raw`find . -exec $'\x61ws' s3 rm s3://bucket/key {} \;`,
    `echo $($'aws' s3 rm s3://bucket/key)`,
    `$\\\n'\\x61ws' s3 rm s3://bucket/key`,
    `$\\\n\\\n'aws' s3 rm s3://bucket/key`,
    `env $\\\n'aws' s3 rm s3://bucket/key`,
  ])('blocks a quoted executable: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBe(false);
  });

  test('allows a read with a quoted argument', () => {
    const command = String.raw`aws logs filter-log-events --log-group-name group --filter-pattern $'a\tb'`;
    expect(isAllowedAwsCommand(command)).toBe(true);
  });

  test.each([
    String.raw`printf $'a\tb'`,
    `echo $"aws s3 rm"`,
    `printf $\\\n'a\\tb'`,
  ])('ignores a quoted argument: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBeUndefined();
  });
});

describe('isAllowedAwsCommand with heredocs', () => {
  const write = 'aws s3 rm s3://bucket/key';
  const read = 'aws sts get-caller-identity';

  test.each([
    `cat > /tmp/m <<'EOF'\nwren's note\nEOF\n${read}`,
    `cat > /tmp/m <<"EOF"\nwren said "hi"\nEOF\n${read}`,
    `cat > /tmp/m <<EOF\nwren's note\nEOF\n${read}`,
    `cat <<-EOF\n\twren's note\n\tEOF\n${read}`,
    `cat <<A <<'B'\nwren's\nA\nit's\nB\n${read}`,
    `cat <<EOF\n$(${read})\nEOF`,
    `cat <<<"wren's"; ${read}`,
  ])('allows a read after or inside a heredoc: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBe(true);
  });

  test.each([
    `cat > /tmp/m <<'EOF'\nwren's note\nEOF\n${write}`,
    `cat <<-EOF\n\twren's note\n\tEOF\n${write}`,
    `cat <<A <<'B'\nwren's\nA\nit's\nB\n${write}`,
    `cat <<EOF\n$(${write})\nEOF`,
    `cat <<EOF\n\`${write}\`\nEOF`,
    `cat <<<"wren's"; ${write}`,
  ])('blocks a write after or inside a heredoc: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBe(false);
  });

  test.each([
    `cat > /tmp/m <<'EOF'\nRun ${read} first.\nEOF`,
    `cat <<'EOF'\n/usr/local/bin/${write}\nEOF`,
    "cat <<'EOF'\na\\ws s3 rm s3://bucket/key\nEOF",
    `cat <<'EOF'\n$(${write})\nEOF\nls`,
    `echo hi # <<EOF\n${write}\nEOF`,
    `cat <<"EOF"x\nEOFx\n${write}\nEOF`,
    `cat <<'EOF'\nAWS s3 rm s3://bucket/key\nEOF`,
    `cat <<'EOF'\n  /usr/local/bin/Aws s3 rm s3://bucket/key\nEOF`,
    `cat <<'EOF'\ntrue; AWS s3 rm s3://bucket/key\nEOF`,
    'echo hi # <<EOF\nAWS s3 rm s3://bucket/key\nEOF',
  ])('blocks a heredoc body that mentions the CLI: %s', (command) => {
    expect(isAllowedAwsCommand(command)).toBe(false);
  });

  test('ignores a heredoc body that names AWS paths but not the CLI', () => {
    const command =
      "cat > /tmp/m <<'EOF'\nfix: aws-permissions, arn:aws:lambda and ~/.aws/config\nEOF";
    expect(isAllowedAwsCommand(command)).toBeUndefined();
  });

  test('ignores a heredoc body that mentions AWS in prose', () => {
    const command =
      "cat > /tmp/m <<'EOF'\nThe handler reads the AWS AppConfig profile (AWS AppConfig).\nEOF";
    expect(isAllowedAwsCommand(command)).toBeUndefined();
  });

  test.each(["cat <<EOF\nwren's note", 'cat <<EOF', 'cat <<'])(
    'blocks an incomplete heredoc: %s',
    (command) => {
      expect(isAllowedAwsCommand(command)).toBe(false);
    },
  );
});
